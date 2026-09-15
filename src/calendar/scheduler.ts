import { DatabaseContext } from '../db/index.js';
import { CalendarProvider } from './provider.js';
import { Appointment, VisitType } from '../types/index.js';
import { computeFreeWindows } from '../utils/slots.js';
import { getBeirutTimeInfo } from '../utils/timezone.js';

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
  allowOverride?: boolean;
}

export interface RescheduleAppointmentParams {
  appointmentId: string;
  newStartTime: string;
  newEndTime?: string;
  visitType?: VisitType;
  address?: string | null;
  allowOverride?: boolean;
}

export interface ActiveShift {
  startMs: number;
  endMs: number;
  startStr: string;
  endStr: string;
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
   * Dynamically retrieves the configured home visit travel/commute buffer in minutes.
   */
  public getHomeVisitBufferMinutes(dateStr?: string): number {
    if (this.db?.settings) {
      if (dateStr) {
        try {
          const [year, month, day] = dateStr.split('-').map(Number);
          const d = new Date(Date.UTC(year, month - 1, day));
          const dayOfWeek = d.getUTCDay();
          const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
          const mondayUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
          const mondayIso = `${mondayUtc.getUTCFullYear()}-${String(mondayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(mondayUtc.getUTCDate()).padStart(2, '0')}`;
          
          const weekVal = parseInt(this.db.settings.get(`home_visit_buffer_minutes_week_${mondayIso}`, ''), 10);
          if (!isNaN(weekVal) && weekVal >= 0) {
            return weekVal;
          }
        } catch {}
      }

      const val = parseInt(this.db.settings.get('home_visit_buffer_minutes', ''), 10);
      if (!isNaN(val) && val >= 0) {
        return val;
      }
    }
    return this.homeVisitBufferMinutes;
  }

  /**
   * Helper to parse date string YYYY-MM-DD into a UTC Day of Week (0 = Sunday, 1 = Monday, ...)
   */
  private getDayOfWeek(dateStr: string): number {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCDay();
  }

  /**
   * Calculates active working shift segments for a given date, supporting split/non-continuous hours.
   */
  public getActiveShiftsForDate(dateStr: string): ActiveShift[] {
    const override = this.db.availability.getOverrideForDate(dateStr);
    if (override && override.is_unavailable) {
      return []; // Doctor is completely off/vacation
    }

    const dayOfWeek = this.getDayOfWeek(dateStr);
    const rule = this.db.availability.getRuleForDay(dayOfWeek);
    if (!rule || !rule.is_active) {
      // If day is normally off, only proceed if an override explicitly opened it
      if (!override || override.is_unavailable) {
        return [];
      }
    }

    let intervals: Array<{ start_time: string; end_time: string }> = [];

    if (override?.shifts && override.shifts.length > 0) {
      intervals = override.shifts;
    } else if (override?.start_time && override?.end_time) {
      intervals = [{ start_time: override.start_time, end_time: override.end_time }];
    } else if (rule?.shifts && rule.shifts.length > 0) {
      intervals = rule.shifts;
    } else {
      intervals = [{
        start_time: rule?.start_time || '09:00',
        end_time: rule?.end_time || '17:00',
      }];
    }

    const [year, month, day] = dateStr.split('-').map(Number);

    return intervals.map((int) => {
      const [sH, sM] = int.start_time.split(':').map(Number);
      const [eH, eM] = int.end_time.split(':').map(Number);
      return {
        startMs: Date.UTC(year, month - 1, day, sH, sM),
        endMs: Date.UTC(year, month - 1, day, eH, eM),
        startStr: int.start_time,
        endStr: int.end_time,
      };
    }).sort((a, b) => a.startMs - b.startMs);
  }

  /**
   * Returns list of available start times (HH:mm) for a given date and visit type,
   * fully supporting split shifts and commute travel buffer.
   */
  public async getAvailableSlots(
    dateStr: string,
    visitType: VisitType,
    durationMinutes: number = this.defaultSlotDurationMinutes,
    referenceNow?: Date
  ): Promise<string[]> {
    const shifts = this.getActiveShiftsForDate(dateStr);
    if (shifts.length === 0) {
      return [];
    }

    const beirutNow = getBeirutTimeInfo(referenceNow || new Date());
    const bufferMinutes = this.getHomeVisitBufferMinutes(dateStr);
    const homeBufferMs = bufferMinutes * 60 * 1000;
    const slotDurationMs = durationMinutes * 60 * 1000;
    const stepMinutes = 30; // Check slots every 30 mins

    // Search range for existing appointments and events across the entire day
    const firstShiftStart = shifts[0].startMs;
    const lastShiftEnd = shifts[shifts.length - 1].endMs;
    const searchStart = new Date(firstShiftStart - 2 * 60 * 60 * 1000);
    const searchEnd = new Date(lastShiftEnd + 2 * 60 * 60 * 1000);

    const dbAppointments = this.db.appointments.getAppointmentsInRange(
      searchStart.toISOString(),
      searchEnd.toISOString()
    );

    const calEvents = await this.calendar.listEvents(searchStart, searchEnd);

    const availableSlots: string[] = [];

    for (const shift of shifts) {
      const stepMs = stepMinutes * 60 * 1000;
      const candidateTimesSet = new Set<number>();

      // 1. Shift start itself can host a full appointment
      if (shift.startMs + slotDurationMs <= shift.endMs) {
        candidateTimesSet.add(shift.startMs);
      }

      // 2. Standard clock grid (:00 and :30) anchored to the clock hour
      const d = new Date(shift.startMs);
      const m = d.getUTCMinutes();
      const s = d.getUTCSeconds();
      const ms = d.getUTCMilliseconds();
      let nextGridMinutes = 0;
      if (m === 0 && s === 0 && ms === 0) {
        nextGridMinutes = 0;
      } else if (m < 30 || (m === 30 && s === 0 && ms === 0)) {
        nextGridMinutes = 30;
      } else {
        nextGridMinutes = 60;
      }
      d.setUTCMinutes(nextGridMinutes, 0, 0);
      let clockStartMs = d.getTime();

      while (clockStartMs + slotDurationMs <= shift.endMs) {
        if (clockStartMs >= shift.startMs) {
          candidateTimesSet.add(clockStartMs);
        }
        clockStartMs += stepMs;
      }

      // 3. Immediately after any existing appointment finishes (plus travel commute if either appointment is a home visit)
      for (const appt of dbAppointments) {
        const apptEndMs = new Date(appt.end_time).getTime();
        const nextAvail = apptEndMs + ((appt.visit_type === 'home_visit' || visitType === 'home_visit') ? homeBufferMs : 0);
        if (nextAvail >= shift.startMs && nextAvail + slotDurationMs <= shift.endMs) {
          candidateTimesSet.add(nextAvail);
        }
      }

      // 4. Immediately after any external calendar event finishes
      for (const ev of calEvents) {
        const evEndMs = ev.end.getTime();
        const nextAvail = evEndMs + (visitType === 'home_visit' ? homeBufferMs : 0);
        if (nextAvail >= shift.startMs && nextAvail + slotDurationMs <= shift.endMs) {
          candidateTimesSet.add(nextAvail);
        }
      }

      const sortedCandidates = Array.from(candidateTimesSet).sort((a, b) => a - b);

      for (const currentStartMs of sortedCandidates) {
        const candidateStart = new Date(currentStartMs);

        // Same-day past slot filter: if querying for TODAY in Beirut time,
        // do not offer slots that have already passed in local clock time.
        if (dateStr === beirutNow.dateStr) {
          const candMinutes = candidateStart.getUTCHours() * 60 + candidateStart.getUTCMinutes();
          if (candMinutes <= beirutNow.totalMinutes) {
            continue;
          }
        }

        // For home visits: ensure appointment + post-travel buffer ends within the shift.
        if (visitType === 'home_visit') {
          if (currentStartMs + slotDurationMs + homeBufferMs > shift.endMs) {
            continue;
          }
        }

        // Check conflict with DB appointments + commute buffer
        let conflict = false;

        for (const appt of dbAppointments) {
          const apptStartMs = new Date(appt.start_time).getTime();
          const apptEndMs = new Date(appt.end_time).getTime();

          // Direct overlap: candidate window overlaps this appointment
          if (currentStartMs < apptEndMs && (currentStartMs + slotDurationMs) > apptStartMs) {
            conflict = true;
            break;
          }

          // Commute buffer rules:
          // If EITHER the existing appointment OR the requested appointment is a HOME VISIT:
          // There must be travel buffer between them!
          // 1. Buffer BEFORE candidate: Doctor travels from previous visit/office to this home visit
          if ((appt.visit_type === 'home_visit' || visitType === 'home_visit') && apptEndMs <= currentStartMs) {
            if ((currentStartMs - apptEndMs) < homeBufferMs) {
              conflict = true;
              break;
            }
          }
          // 2. Buffer AFTER candidate: Doctor travels back from this home visit or to next visit
          if ((visitType === 'home_visit' || appt.visit_type === 'home_visit') && apptStartMs >= (currentStartMs + slotDurationMs)) {
            if ((apptStartMs - (currentStartMs + slotDurationMs)) < homeBufferMs) {
              conflict = true;
              break;
            }
          }
        }

        if (conflict) continue;

        // Check conflict with external Google Calendar events + travel buffer
        const commuteGap = (visitType === 'home_visit' ? homeBufferMs : 0);
        for (const ev of calEvents) {
          if (ev.id) {
            const matchedAppt = this.db.appointments.findByGoogleEventId(ev.id);
            if (matchedAppt && matchedAppt.status === 'cancelled') {
              continue;
            }
          }
          const evStartMs = ev.start.getTime();
          const evEndMs = ev.end.getTime();

          // Candidate directly overlaps event OR candidate (home visit) return buffer overlaps next event start
          if (currentStartMs < evEndMs && (currentStartMs + slotDurationMs + commuteGap) > evStartMs) {
            conflict = true;
            break;
          }
        }

        if (!conflict) {
          const hh = String(candidateStart.getUTCHours()).padStart(2, '0');
          const mm = String(candidateStart.getUTCMinutes()).padStart(2, '0');
          const timeSlot = `${hh}:${mm}`;
          if (!availableSlots.includes(timeSlot)) {
            availableSlots.push(timeSlot);
          }
        }
      }
    }

    return availableSlots;
  }

  /**
   * Books an appointment deterministically after validating against shifts and commute travel buffer.
   */
  public async bookAppointment(params: BookAppointmentParams): Promise<Appointment> {
    if (params.visitType === 'home_visit' && !params.address) {
      throw new Error('A physical address is required for home visits.');
    }

    const startTime = new Date(params.startTime);
    const durationMs = this.defaultSlotDurationMinutes * 60 * 1000;
    const endTime = params.endTime ? new Date(params.endTime) : new Date(startTime.getTime() + durationMs);

    const bufferMinutes = this.getHomeVisitBufferMinutes();
    const bufferMs = (params.visitType === 'home_visit' ? bufferMinutes : 0) * 60 * 1000;

    if (!params.allowOverride) {
      // Check if slot falls inside one of the active shifts for the day
      const dateStr = startTime.toISOString().split('T')[0];
      const shifts = this.getActiveShiftsForDate(dateStr);
      if (shifts.length > 0) {
        const fitsInShift = shifts.some((s) => {
          if (params.visitType === 'home_visit') {
            // No pre-buffer needed — doctor is already present at shift start.
            // Only enforce that the appointment + post-travel buffer ends within the shift.
            return (startTime.getTime() >= s.startMs && endTime.getTime() + bufferMs <= s.endMs);
          }
          return (startTime.getTime() >= s.startMs && endTime.getTime() <= s.endMs);
        });
        if (!fitsInShift) {
          throw new Error(`Time slot conflict: Requested time is outside doctor's active working hours or travel buffer.`);
        }
      }

      // Conflict check with existing DB appointments
      const searchStart = new Date(startTime.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const searchEnd = new Date(endTime.getTime() + 2 * 60 * 60 * 1000).toISOString();
      const existingAppointments = this.db.appointments.getAppointmentsInRange(searchStart, searchEnd);

      for (const appt of existingAppointments) {
        const apptStartMs = new Date(appt.start_time).getTime();
        const apptEndMs = new Date(appt.end_time).getTime();

        // Direct overlap
        if (startTime.getTime() < apptEndMs && endTime.getTime() > apptStartMs) {
          throw new Error(`Time slot conflict: Doctor already has an appointment or travel buffer at this time.`);
        }

        // Commute buffer check:
        // If EITHER appointment is a home visit, travel time is required between them.
        const bufferGapMs = bufferMinutes * 60 * 1000;
        if ((appt.visit_type === 'home_visit' || params.visitType === 'home_visit') && apptEndMs <= startTime.getTime()) {
          if ((startTime.getTime() - apptEndMs) < bufferGapMs) {
            throw new Error(`Time slot conflict: Doctor already has an appointment or travel buffer at this time.`);
          }
        }
        if ((params.visitType === 'home_visit' || appt.visit_type === 'home_visit') && apptStartMs >= endTime.getTime()) {
          if ((apptStartMs - endTime.getTime()) < bufferGapMs) {
            throw new Error(`Time slot conflict: Doctor already has an appointment or travel buffer at this time.`);
          }
        }
      }

      // Conflict check with Calendar events
      // Only home visits require a return commute buffer after the appointment
      const calCommuteGap = (params.visitType === 'home_visit' ? bufferMinutes : 0) * 60 * 1000;
      const calEvents = await this.calendar.listEvents(
        startTime,
        new Date(endTime.getTime() + calCommuteGap)
      );
      for (const ev of calEvents) {
        if (ev.id) {
          const matchedAppt = this.db.appointments.findByGoogleEventId(ev.id);
          if (matchedAppt && matchedAppt.status === 'cancelled') {
            this.calendar.deleteEvent(ev.id).catch(() => {});
            continue;
          }
        }
        const evStartMs = ev.start.getTime();
        const evEndMs = ev.end.getTime();
        if (startTime.getTime() < evEndMs && (endTime.getTime() + calCommuteGap) > evStartMs) {
          throw new Error(`Time slot conflict: Google Calendar has an existing event at this time.`);
        }
      }
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
   * Reschedules an existing appointment to a new time with commute and shift validation.
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

    const bufferMinutes = this.getHomeVisitBufferMinutes();
    const bufferMs = (visitType === 'home_visit' ? bufferMinutes : 0) * 60 * 1000;

    if (!params.allowOverride) {
      // Check shifts
      const dateStr = newStart.toISOString().split('T')[0];
      const shifts = this.getActiveShiftsForDate(dateStr);
      if (shifts.length > 0) {
        const fitsInShift = shifts.some((s) => {
          if (visitType === 'home_visit') {
            return (newStart.getTime() >= s.startMs && newEnd.getTime() + bufferMs <= s.endMs);
          }
          return (newStart.getTime() >= s.startMs && newEnd.getTime() <= s.endMs);
        });
        if (!fitsInShift) {
          throw new Error(`Time slot conflict: Requested time is outside doctor's active working hours or travel buffer.`);
        }
      }

      // Conflict check (excluding the current appointment itself)
      const existingAppointments = this.db.appointments.getAppointmentsInRange(
        new Date(newStart.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        new Date(newEnd.getTime() + 2 * 60 * 60 * 1000).toISOString()
      );

      for (const appt of existingAppointments) {
        if (appt.id === existing.id) continue; // skip self

        const apptStartMs = new Date(appt.start_time).getTime();
        const apptEndMs = new Date(appt.end_time).getTime();

        if (newStart.getTime() < apptEndMs && newEnd.getTime() > apptStartMs) {
          throw new Error(`Time slot conflict: Doctor already has an appointment or travel buffer at this time.`);
        }

        // Commute buffer check:
        // If EITHER appointment is a home visit, travel time is required between them.
        const bufferGapMs = bufferMinutes * 60 * 1000;
        if ((appt.visit_type === 'home_visit' || visitType === 'home_visit') && apptEndMs <= newStart.getTime()) {
          if ((newStart.getTime() - apptEndMs) < bufferGapMs) {
            throw new Error(`Time slot conflict: Doctor already has an appointment or travel buffer at this time.`);
          }
        }
        if ((visitType === 'home_visit' || appt.visit_type === 'home_visit') && apptStartMs >= newEnd.getTime()) {
          if ((apptStartMs - newEnd.getTime()) < bufferGapMs) {
            throw new Error(`Time slot conflict: Doctor already has an appointment or travel buffer at this time.`);
          }
        }
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
   * Searches available slots across a range of days (e.g. next 14 days),
   * providing multi-week availability for customer inquiries.
   */
  public async getAvailableSlotsAcrossRange(
    startDateStr: string,
    daysCount: number = 7,
    visitType: VisitType = 'in_office',
    maxOpenDays: number = 7,
    referenceNow?: Date
  ): Promise<Array<{ date: string; day_name: string; is_closed: boolean; hours?: string; available_slots: string[]; free_windows: Array<{ from: string; to: string; from12: string; to12: string }> }>> {
    const results: Array<{ date: string; day_name: string; is_closed: boolean; hours?: string; available_slots: string[]; free_windows: Array<{ from: string; to: string; from12: string; to12: string }> }> = [];
    const [year, month, day] = startDateStr.split('-').map(Number);
    const startUtc = new Date(Date.UTC(year, month - 1, day));
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let i = 0; i < daysCount; i++) {
      const curDate = new Date(startUtc.getTime() + i * 24 * 60 * 60 * 1000);
      const curDateStr = curDate.toISOString().split('T')[0];
      const dayName = dayNames[curDate.getUTCDay()];

      const shifts = this.getActiveShiftsForDate(curDateStr);
      const slots = await this.getAvailableSlots(curDateStr, visitType, this.defaultSlotDurationMinutes, referenceNow);

      if (shifts.length === 0 || slots.length === 0) {
        results.push({
          date: curDateStr,
          day_name: dayName,
          is_closed: true,
          available_slots: [],
          free_windows: [],
        });
      } else {
        const hoursSummary = shifts.map((s) => `${s.startStr} to ${s.endStr}`).join(', ');
        results.push({
          date: curDateStr,
          day_name: dayName,
          is_closed: false,
          hours: hoursSummary,
          available_slots: slots,
          free_windows: computeFreeWindows(slots),
        });
      }
    }

    return results;
  }

  /**
   * Finds all upcoming active appointments on a specific date that conflict with updated shifts or blockout.
   */
  public getConflictingAppointmentsForDate(dateStr: string): Appointment[] {
    const shifts = this.getActiveShiftsForDate(dateStr);
    const [year, month, day] = dateStr.split('-').map(Number);
    const dayStartIso = new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
    const dayEndIso = new Date(Date.UTC(year, month - 1, day, 23, 59, 59)).toISOString();

    const appts = this.db.appointments.getAppointmentsInRange(dayStartIso, dayEndIso);
    const conflicts: Appointment[] = [];

    for (const appt of appts) {
      if (appt.status === 'cancelled' || appt.status === 'completed') continue;

      const apptStartMs = new Date(appt.start_time).getTime();
      const apptEndMs = new Date(appt.end_time).getTime();

      // If doctor is completely closed, all appointments conflict
      if (shifts.length === 0) {
        conflicts.push(appt);
        continue;
      }

      // Check if appointment fits within any shift
      const fits = shifts.some((s) => apptStartMs >= s.startMs && apptEndMs <= s.endMs);
      if (!fits) {
        conflicts.push(appt);
      }
    }

    return conflicts;
  }

  /**
   * Finds all upcoming active appointments on a given day-of-week that conflict with newly updated weekly shifts.
   */
  public getConflictingAppointmentsForWeeklyChange(
    dayOfWeek: number,
    newShifts: Array<{ start_time: string; end_time: string }>,
    isActive: boolean
  ): Appointment[] {
    const upcoming = this.db.appointments.listUpcoming(100);
    const conflicts: Appointment[] = [];

    for (const appt of upcoming) {
      if (appt.status === 'cancelled' || appt.status === 'completed') continue;

      const apptDate = new Date(appt.start_time);
      if (apptDate.getUTCDay() !== dayOfWeek) continue;

      const dateStr = apptDate.toISOString().split('T')[0];
      const override = this.db.availability.getOverrideForDate(dateStr);
      if (override) continue; // specific override takes precedence

      if (!isActive || !newShifts || newShifts.length === 0) {
        conflicts.push(appt);
        continue;
      }

      const [y, m, d] = dateStr.split('-').map(Number);
      const shiftIntervals = newShifts.map((s) => {
        const [sH, sM] = s.start_time.split(':').map(Number);
        const [eH, eM] = s.end_time.split(':').map(Number);
        return {
          startMs: Date.UTC(y, m - 1, d, sH, sM),
          endMs: Date.UTC(y, m - 1, d, eH, eM),
        };
      });

      const apptStartMs = apptDate.getTime();
      const apptEndMs = new Date(appt.end_time).getTime();
      const fits = shiftIntervals.some((s) => apptStartMs >= s.startMs && apptEndMs <= s.endMs);

      if (!fits) {
        conflicts.push(appt);
      }
    }

    return conflicts;
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
