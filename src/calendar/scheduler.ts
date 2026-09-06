import { DatabaseContext } from '../db/index.js';
import { CalendarProvider } from './provider.js';
import { Appointment, VisitType } from '../types/index.js';

export interface SchedulerOptions {
  db: DatabaseContext;
  calendar: CalendarProvider;
  homeVisitBufferMinutes?: number; // default 30 mins
  defaultSlotDurationMinutes?: number; // default 60 mins
}

export interface BookAppointmentParams {
  customerId: string;
  customerPhone: string;
  customerName?: string | null;
  visitType: VisitType;
  address?: string | null;
  service: string;
  price?: number;
  startTime: string; // ISO 8601 string
  endTime?: string;  // ISO 8601 string
  notes?: string | null;
}

export interface RescheduleAppointmentParams {
  appointmentId: string;
  newStartTime: string;
  newEndTime?: string;
  visitType?: VisitType;
  address?: string | null;
}

export class SchedulingEngine {
  private db: DatabaseContext;
  private calendar: CalendarProvider;
  private homeVisitBufferMinutes: number;
  private defaultSlotDurationMinutes: number;

  constructor(options: SchedulerOptions) {
    this.db = options.db;
    this.calendar = options.calendar;
    this.homeVisitBufferMinutes = options.homeVisitBufferMinutes ?? 30;
    this.defaultSlotDurationMinutes = options.defaultSlotDurationMinutes ?? 60;
  }

  /**
   * Helper to parse date string YYYY-MM-DD into a UTC or local Day of Week
   */
  private getDayOfWeek(dateStr: string): number {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCDay();
  }

  /**
   * Returns list of available start times (HH:mm) for a given date and visit type.
   */
  public async getAvailableSlots(
    dateStr: string,
    visitType: VisitType,
    durationMinutes: number = this.defaultSlotDurationMinutes
  ): Promise<string[]> {
    // 1. Check overrides
    const override = this.db.availability.getOverrideForDate(dateStr);
    if (override && override.is_unavailable) {
      return []; // Doctor is completely unavailable/vacation
    }

    // 2. Check weekly rule
    const dayOfWeek = this.getDayOfWeek(dateStr);
    const rule = this.db.availability.getRuleForDay(dayOfWeek);
    if (!rule || !rule.is_active) {
      // Unless an override explicitly opened this date
      if (!override || override.is_unavailable) {
        return [];
      }
    }

    const startWindow = override?.start_time || rule?.start_time || '09:00';
    const endWindow = override?.end_time || rule?.end_time || '17:00';

    const [startH, startM] = startWindow.split(':').map(Number);
    const [endH, endM] = endWindow.split(':').map(Number);

    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const windowStartMs = Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), startH, startM);
    const windowEndMs = Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), endH, endM);

    // Fetch existing appointments and calendar events for this day + surrounding buffers
    const searchStart = new Date(windowStartMs - 2 * 60 * 60 * 1000);
    const searchEnd = new Date(windowEndMs + 2 * 60 * 60 * 1000);

    const dbAppointments = this.db.appointments.getAppointmentsInRange(
      searchStart.toISOString(),
      searchEnd.toISOString()
    );

    const calEvents = await this.calendar.listEvents(searchStart, searchEnd);

    const availableSlots: string[] = [];
    const stepMinutes = 30; // Check slots every 30 mins
    const slotDurationMs = durationMinutes * 60 * 1000;
    const bufferMs = (visitType === 'home_visit' ? this.homeVisitBufferMinutes : 0) * 60 * 1000;

    let currentStartMs = windowStartMs;

    while (currentStartMs + slotDurationMs <= windowEndMs) {
      const candidateStart = new Date(currentStartMs);
      const candidateEnd = new Date(currentStartMs + slotDurationMs);

      // Travel buffer window needed for the candidate appointment
      const candidateRequiredStart = new Date(currentStartMs - bufferMs);
      const candidateRequiredEnd = new Date(currentStartMs + slotDurationMs + bufferMs);

      // Verify the required start and end fit reasonably within business hours
      if (candidateRequiredStart.getTime() < windowStartMs || candidateRequiredEnd.getTime() > windowEndMs) {
        currentStartMs += stepMinutes * 60 * 1000;
        continue;
      }

      // Check conflict with DB appointments
      let conflict = false;
      for (const appt of dbAppointments) {
        const apptStartMs = new Date(appt.start_time).getTime();
        const apptEndMs = new Date(appt.end_time).getTime();
        const apptBufferMs = (appt.visit_type === 'home_visit' ? this.homeVisitBufferMinutes : 0) * 60 * 1000;

        const effectiveApptStart = apptStartMs - apptBufferMs;
        const effectiveApptEnd = apptEndMs + apptBufferMs;

        // Overlap if candidateRequiredStart < effectiveApptEnd && candidateRequiredEnd > effectiveApptStart
        if (candidateRequiredStart.getTime() < effectiveApptEnd && candidateRequiredEnd.getTime() > effectiveApptStart) {
          conflict = true;
          break;
        }
      }

      // Check conflict with Google Calendar events
      if (!conflict) {
        for (const ev of calEvents) {
          if (candidateRequiredStart < ev.end && candidateRequiredEnd > ev.start) {
            conflict = true;
            break;
          }
        }
      }

      if (!conflict) {
        const hh = String(candidateStart.getUTCHours()).padStart(2, '0');
        const mm = String(candidateStart.getUTCMinutes()).padStart(2, '0');
        availableSlots.push(`${hh}:${mm}`);
      }

      currentStartMs += stepMinutes * 60 * 1000;
    }

    return availableSlots;
  }

  /**
   * Books an appointment deterministically after validating against conflicts.
   */
  public async bookAppointment(params: BookAppointmentParams): Promise<Appointment> {
    if (params.visitType === 'home_visit' && !params.address) {
      throw new Error('A physical address is required for home visits.');
    }

    const startTime = new Date(params.startTime);
    const durationMs = this.defaultSlotDurationMinutes * 60 * 1000;
    const endTime = params.endTime ? new Date(params.endTime) : new Date(startTime.getTime() + durationMs);

    const bufferMs = (params.visitType === 'home_visit' ? this.homeVisitBufferMinutes : 0) * 60 * 1000;
    const requiredStart = new Date(startTime.getTime() - bufferMs);
    const requiredEnd = new Date(endTime.getTime() + bufferMs);

    // Conflict check with existing DB appointments
    const searchStart = new Date(requiredStart.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const searchEnd = new Date(requiredEnd.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const existingAppointments = this.db.appointments.getAppointmentsInRange(searchStart, searchEnd);

    for (const appt of existingAppointments) {
      const apptStartMs = new Date(appt.start_time).getTime();
      const apptEndMs = new Date(appt.end_time).getTime();
      const apptBufferMs = (appt.visit_type === 'home_visit' ? this.homeVisitBufferMinutes : 0) * 60 * 1000;

      const effectiveApptStart = apptStartMs - apptBufferMs;
      const effectiveApptEnd = apptEndMs + apptBufferMs;

      if (requiredStart.getTime() < effectiveApptEnd && requiredEnd.getTime() > effectiveApptStart) {
        throw new Error(`Time slot conflict: Doctor already has an appointment or travel buffer at this time.`);
      }
    }

    // Conflict check with Calendar events
    const calEvents = await this.calendar.listEvents(requiredStart, requiredEnd);
    if (calEvents.length > 0) {
      throw new Error(`Time slot conflict: Google Calendar has an existing event at this time.`);
    }

    // 1. Create Google Calendar Event
    const summary = `${params.service} - ${params.customerName || params.customerPhone} (${params.visitType === 'home_visit' ? 'Home Visit' : 'In-Office'})`;
    const description = [
      `Customer: ${params.customerName || 'Unknown'} (${params.customerPhone})`,
      `Visit Type: ${params.visitType}`,
      params.visitType === 'home_visit' ? `Address: ${params.address}` : `Location: Office`,
      `Service: ${params.service}`,
      `Price: $${params.price ?? 100}`,
      params.notes ? `Notes: ${params.notes}` : '',
    ].filter(Boolean).join('\n');

    const calEventId = await this.calendar.createEvent({
      summary,
      description,
      location: params.visitType === 'home_visit' ? params.address || undefined : 'Office Clinic',
      start: startTime,
      end: endTime,
    });

    // 2. Create DB appointment
    const appt = this.db.appointments.create({
      customer_id: params.customerId,
      visit_type: params.visitType,
      address: params.address || null,
      service: params.service,
      price: params.price ?? 100,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      status: 'booked',
      google_event_id: calEventId,
      notes: params.notes || null,
    });

    return appt;
  }

  /**
   * Reschedules an existing appointment to a new time.
   */
  public async rescheduleAppointment(params: RescheduleAppointmentParams): Promise<Appointment> {
    const existing = this.db.appointments.findById(params.appointmentId);
    if (!existing) {
      throw new Error(`Appointment ${params.appointmentId} not found.`);
    }

    const visitType = params.visitType || existing.visit_type;
    const address = params.address !== undefined ? params.address : existing.address;

    if (visitType === 'home_visit' && !address) {
      throw new Error('A physical address is required for home visits.');
    }

    const newStart = new Date(params.newStartTime);
    const durationMs = (new Date(existing.end_time).getTime() - new Date(existing.start_time).getTime()) || (60 * 60 * 1000);
    const newEnd = params.newEndTime ? new Date(params.newEndTime) : new Date(newStart.getTime() + durationMs);

    const bufferMs = (visitType === 'home_visit' ? this.homeVisitBufferMinutes : 0) * 60 * 1000;
    const requiredStart = new Date(newStart.getTime() - bufferMs);
    const requiredEnd = new Date(newEnd.getTime() + bufferMs);

    // Conflict check (excluding the current appointment itself)
    const existingAppointments = this.db.appointments.getAppointmentsInRange(
      new Date(requiredStart.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      new Date(requiredEnd.getTime() + 2 * 60 * 60 * 1000).toISOString()
    );

    for (const appt of existingAppointments) {
      if (appt.id === existing.id) continue; // skip self

      const apptStartMs = new Date(appt.start_time).getTime();
      const apptEndMs = new Date(appt.end_time).getTime();
      const apptBufferMs = (appt.visit_type === 'home_visit' ? this.homeVisitBufferMinutes : 0) * 60 * 1000;

      const effectiveApptStart = apptStartMs - apptBufferMs;
      const effectiveApptEnd = apptEndMs + apptBufferMs;

      if (requiredStart.getTime() < effectiveApptEnd && requiredEnd.getTime() > effectiveApptStart) {
        throw new Error(`Time slot conflict: Doctor already has an appointment or travel buffer at this time.`);
      }
    }

    // Update Calendar
    if (existing.google_event_id) {
      try {
        await this.calendar.updateEvent(existing.google_event_id, {
          summary: `${existing.service} (Rescheduled) - ${visitType === 'home_visit' ? 'Home Visit' : 'In-Office'}`,
          start: newStart,
          end: newEnd,
          location: visitType === 'home_visit' ? address || undefined : 'Office Clinic',
        });
      } catch {
        // Continue even if remote calendar update fails
      }
    }

    // Update DB
    this.db.appointments.reschedule(
      existing.id,
      newStart.toISOString(),
      newEnd.toISOString(),
      visitType,
      address
    );

    return this.db.appointments.findById(existing.id)!;
  }

  /**
   * Cancels an appointment.
   */
  public async cancelAppointment(appointmentId: string, reason?: string): Promise<Appointment> {
    const existing = this.db.appointments.findById(appointmentId);
    if (!existing) {
      throw new Error(`Appointment ${appointmentId} not found.`);
    }

    if (existing.google_event_id) {
      try {
        await this.calendar.deleteEvent(existing.google_event_id);
      } catch {
        // Remote event might already be deleted
      }
    }

    this.db.appointments.cancel(existing.id, reason);
    return this.db.appointments.findById(existing.id)!;
  }
}
