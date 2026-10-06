import { DatabaseContext } from '../db/index.js';
import crypto from 'node:crypto';
import { CalendarProvider } from './provider.js';
import { Appointment, VisitType } from '../types/index.js';
import { computeFreeWindows } from '../utils/slots.js';
import { getBeirutTimeInfo, beirutDateTimeToUtc } from '../utils/timezone.js';

export interface SchedulerOptions {
  db: DatabaseContext;
  calendar: CalendarProvider;
  homeVisitBufferMinutes?: number; // default 30 mins
  defaultSlotDurationMinutes?: number; // default 60 mins
}

export interface BookAppointmentParams {
  operationId?: string;
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
  service?: string;
  notes?: string | null;
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !Number.isFinite(new Date(`${dateStr}T00:00:00Z`).getTime()) || new Date(`${dateStr}T00:00:00Z`).toISOString().slice(0,10) !== dateStr) throw new Error('Invalid calendar date');
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
        startMs: beirutDateTimeToUtc(dateStr, int.start_time).getTime(),
        endMs: beirutDateTimeToUtc(dateStr, int.end_time).getTime(),
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
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480) throw new Error('Invalid appointment duration');
    if (dateStr < getBeirutTimeInfo(referenceNow || new Date()).dateStr) return [];
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
    const searchStart = new Date(firstShiftStart - Math.max(homeBufferMs, 2 * 60 * 60 * 1000));
    const searchEnd = new Date(lastShiftEnd + Math.max(homeBufferMs, 2 * 60 * 60 * 1000));

    const dbAppointments = [
      ...this.db.appointments.getAppointmentsInRange(searchStart.toISOString(), searchEnd.toISOString()),
      ...(this.db.appDb.db.prepare('SELECT * FROM scheduling_reservations WHERE start_time < ? AND end_time > ?').all(searchEnd.toISOString(),searchStart.toISOString()) as unknown as Appointment[]),
    ];

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

        // Same-day past & lead-time filter: if querying for TODAY in Beirut time,
        // do not offer slots that are in the past or lack required commute/advance notice.
        // - Home visit: requires at least bufferMinutes (e.g. 30m) travel commute from current time.
        // - In-office visit: requires at least 15m advance notice.
        if (dateStr === beirutNow.dateStr) {
          const candMinutes = (candidateStart.getTime() - (referenceNow || new Date()).getTime()) / 60000;
          const minLeadTimeMinutes = visitType === 'home_visit' ? bufferMinutes : 15;
          if (candMinutes < minLeadTimeMinutes) {
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
          if ((currentStartMs - commuteGap) < evEndMs && (currentStartMs + slotDurationMs + commuteGap) > evStartMs) {
            conflict = true;
            break;
          }
        }

        if (!conflict) {
          const hh = String(getBeirutTimeInfo(candidateStart).hour).padStart(2, '0');
          const mm = String(getBeirutTimeInfo(candidateStart).minute).padStart(2, '0');
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
    const operationKey = params.operationId ? `${params.customerId}:${params.operationId}` : null;
    if (operationKey) {
      const previous = this.db.appDb.db.prepare('SELECT appointment_id FROM appointment_operations WHERE operation_key = ?').get(operationKey) as any;
      if (previous) return this.db.appointments.findById(previous.appointment_id)!;
    }
    if (params.visitType === 'home_visit' && !params.address) {
      throw new Error('A physical address is required for home visits.');
    }

    const startTime = new Date(params.startTime);
    const durationMs = this.defaultSlotDurationMinutes * 60 * 1000;
    const endTime = params.endTime ? new Date(params.endTime) : new Date(startTime.getTime() + durationMs);

    this.validateWindow(startTime, endTime, params.startTime, params.visitType, params.allowOverride);
    const reservation = this.acquireReservation(params.customerId, startTime, endTime, params.visitType);
    try {
    const bufferMinutes = this.getHomeVisitBufferMinutes(getBeirutTimeInfo(startTime).dateStr);
    const bufferMs = (params.visitType === 'home_visit' ? bufferMinutes : 0) * 60 * 1000;

    {
      // Check if slot falls inside one of the active shifts for the day
      const dateStr = getBeirutTimeInfo(startTime).dateStr;
      const shifts = this.getActiveShiftsForDate(dateStr);
      if (!params.allowOverride) {
        if (shifts.length === 0) throw new Error("Clinic is closed; no active working hours on this date");
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
        new Date(startTime.getTime() - calCommuteGap),
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
        if ((startTime.getTime() - calCommuteGap) < evEndMs && (endTime.getTime() + calCommuteGap) > evStartMs) {
          throw new Error(`Time slot conflict: Google Calendar has an existing event at this time.`);
        }
      }
    }

    const eventId=crypto.randomUUID().replaceAll('-', '');
    const payload={params,operationKey,event:{id:eventId,summary:`${params.service} - ${params.customerName || params.customerPhone}`,description:params.notes || undefined,location:params.visitType==='home_visit' ? params.address : 'Office Clinic',start:startTime.toISOString(),end:endTime.toISOString()}};
    const op=this.journal('book',payload,reservation);
    return await this.applyCalendarOperation(op);
    } finally {
      if (!this.hasPendingReservation(reservation)) this.db.appDb.db.prepare('DELETE FROM scheduling_reservations WHERE id = ?').run(reservation);
    }
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

    this.validateWindow(newStart, newEnd, params.newStartTime, visitType, params.allowOverride);
    if (!['booked','confirmed','rescheduled'].includes(existing.status)) throw new Error('Only active appointments can be rescheduled');
    const reservation = this.acquireReservation(existing.customer_id, newStart, newEnd, visitType, existing.id);
    try {
    const bufferMinutes = this.getHomeVisitBufferMinutes(getBeirutTimeInfo(newStart).dateStr);
    const bufferMs = (visitType === 'home_visit' ? bufferMinutes : 0) * 60 * 1000;

    {
      // Check shifts
      const dateStr = getBeirutTimeInfo(newStart).dateStr;
      const shifts = this.getActiveShiftsForDate(dateStr);
      if (!params.allowOverride) {
        if (shifts.length === 0) throw new Error("Clinic is closed; no active working hours on this date");
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

    const travel=visitType==='home_visit' ? bufferMinutes*60000 : 0;
    const events=await this.calendar.listEvents(new Date(newStart.getTime()-travel),new Date(newEnd.getTime()+travel));
    for (const event of events) {
      if (event.id && event.id===existing.google_event_id) continue;
      if (newStart.getTime()-travel < event.end.getTime() && newEnd.getTime()+travel > event.start.getTime()) throw new Error('Time slot conflict: Google Calendar has an existing event at this time');
    }
    const op=this.journal('move',{appointmentId:existing.id,eventId:existing.google_event_id,newStart:newStart.toISOString(),newEnd:newEnd.toISOString(),visitType,address,service:params.service,notes:params.notes},reservation);
    return await this.applyCalendarOperation(op);
    } finally {
      if (!this.hasPendingReservation(reservation)) this.db.appDb.db.prepare('DELETE FROM scheduling_reservations WHERE id = ?').run(reservation);
    }
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
    const dayStartIso = new Date(Date.UTC(year, month - 1, day) - 86400000).toISOString();
    const dayEndIso = new Date(Date.UTC(year, month - 1, day) + 86400000).toISOString();

    const appts = this.db.appointments.getAppointmentsInRange(dayStartIso, dayEndIso).filter(a => getBeirutTimeInfo(new Date(a.start_time)).dateStr === dateStr);
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
      if (getBeirutTimeInfo(apptDate).dayOfWeek !== dayOfWeek) continue;

      const dateStr = getBeirutTimeInfo(apptDate).dateStr;
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
          startMs: beirutDateTimeToUtc(dateStr, s.start_time).getTime(),
          endMs: beirutDateTimeToUtc(dateStr, s.end_time).getTime(),
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

  private acquireReservation(customerId: string, start: Date, end: Date, visitType: VisitType, appointmentId?: string): string {
    const sql = this.db.appDb.db;
    const buffer = this.getHomeVisitBufferMinutes(getBeirutTimeInfo(start).dateStr)*60000;
    sql.exec('BEGIN IMMEDIATE');
    try {
      if (appointmentId && sql.prepare('SELECT id FROM scheduling_reservations WHERE appointment_id = ?').get(appointmentId)) throw new Error('Appointment change already in progress');
      const rows = [
        ...sql.prepare("SELECT id, visit_type, start_time, end_time FROM appointments WHERE status IN ('booked','confirmed','rescheduled')").all(),
        ...sql.prepare('SELECT appointment_id AS id, visit_type, start_time, end_time FROM scheduling_reservations').all(),
      ] as Array<{id?:string;visit_type:string;start_time:string;end_time:string}>;
      for (const row of rows) {
        if (appointmentId && row.id === appointmentId) continue;
        const travel = visitType === 'home_visit' || row.visit_type === 'home_visit' ? buffer : 0;
        if (start.getTime() < new Date(row.end_time).getTime()+travel && end.getTime()+travel > new Date(row.start_time).getTime()) throw new Error('Time slot conflict: appointment, reservation or travel buffer already occupies this time.');
      }
      const id=crypto.randomUUID();
      sql.prepare('INSERT INTO scheduling_reservations (id, customer_id, appointment_id, visit_type, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, customerId, appointmentId || null, visitType, start.toISOString(), end.toISOString(), new Date().toISOString());
      sql.exec('COMMIT'); return id;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  }

  private validateWindow(start: Date, end: Date, rawStart: string, visitType: VisitType, override?: boolean): void {
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error('Invalid appointment date or time');
    this.getActiveShiftsForDate(getBeirutTimeInfo(start).dateStr);
    if (visitType !== 'in_office' && visitType !== 'home_visit') throw new Error('Invalid visit type');
    const duration = (end.getTime()-start.getTime())/60000;
    if (duration <= 0 || duration > 480) throw new Error('End time must follow start time; invalid duration');
    if (start.getTime() <= Date.now()) throw new Error('Appointment must be in the future, not in the past');
    if (!override) {
      const now = getBeirutTimeInfo(); const date = getBeirutTimeInfo(start).dateStr;
      const lead = visitType === 'home_visit' ? this.getHomeVisitBufferMinutes(date) : 15;
      if (start.getTime() - Date.now() < lead*60000) throw new Error('Insufficient advance notice for appointment');
    }
  }

  /**
   * Cancels an appointment.
   */
  public async cancelAppointment(appointmentId: string, reason?: string): Promise<Appointment> {
    const existing = this.db.appointments.findById(appointmentId);
    if (!existing) {
      throw new Error(`Appointment ${appointmentId} not found.`);
    }

    if (existing.status==='cancelled') return existing;
    if (!['booked','confirmed','rescheduled'].includes(existing.status)) throw new Error('Only active appointments can be cancelled');
    if (this.db.appDb.db.prepare('SELECT id FROM scheduling_reservations WHERE appointment_id = ?').get(existing.id)) throw new Error('Appointment change already in progress');
    return this.applyCalendarOperation(this.journal('cancel',{appointmentId:existing.id,eventId:existing.google_event_id,reason}));
  }

  private hasPendingReservation(id:string):boolean {
    return !!this.db.appDb.db.prepare('SELECT id FROM calendar_operations WHERE reservation_id = ?').get(id);
  }
  private journal(kind:string,payload:any,reservation?:string):string {
    const id=crypto.randomUUID();this.db.appDb.db.prepare('INSERT INTO calendar_operations (id,kind,payload,reservation_id,created_at) VALUES (?,?,?,?,?)').run(id,kind,JSON.stringify(payload),reservation || null,new Date().toISOString());return id;
  }
  private activeOperations = new Set<string>();
  private async applyCalendarOperation(id:string):Promise<Appointment> {
    if (this.activeOperations.has(id)) throw new Error('Calendar operation already in progress');
    this.activeOperations.add(id);
    const sql=this.db.appDb.db;const op=sql.prepare('SELECT * FROM calendar_operations WHERE id = ?').get(id) as any;
    const p=JSON.parse(op.payload);let result:Appointment;
    try {
      if (op.kind==='book') {
        const eventId=await this.calendar.createEvent({...p.event,start:new Date(p.event.start),end:new Date(p.event.end)});
        sql.exec('BEGIN IMMEDIATE');
        try {
          result=this.db.appointments.create({customer_id:p.params.customerId,visit_type:p.params.visitType,address:p.params.address || null,service:p.params.service,price:p.params.price ?? 100,start_time:p.event.start,end_time:p.event.end,status:'booked',google_event_id:eventId,notes:p.params.notes || null});
          if (p.operationKey) sql.prepare('INSERT INTO appointment_operations (operation_key,appointment_id) VALUES (?,?)').run(p.operationKey,result.id);
          this.finishOperation(op);sql.exec('COMMIT');
        } catch (e) {sql.exec('ROLLBACK');throw e;}
      } else {
        if (p.eventId) {
          if (op.kind==='cancel') await this.calendar.deleteEvent(p.eventId);
          else await this.calendar.updateEvent(p.eventId,{summary:p.service as any,description:p.notes ?? undefined,start:new Date(p.newStart),end:new Date(p.newEnd),location:p.visitType==='home_visit' ? p.address : 'Office Clinic'});
        }
        sql.exec('BEGIN IMMEDIATE');
        try {
          if (op.kind==='cancel') this.db.appointments.cancel(p.appointmentId,p.reason);
          else {
            this.db.appointments.reschedule(p.appointmentId,p.newStart,p.newEnd,p.visitType,p.address);
            const changes:any={};if(p.service!==undefined) changes.service=p.service;if(p.notes!==undefined) changes.notes=p.notes;
            if(Object.keys(changes).length) this.db.appointments.update(p.appointmentId,changes);
          }
          result=this.db.appointments.findById(p.appointmentId)!;this.finishOperation(op);sql.exec('COMMIT');
        } catch (e) {sql.exec('ROLLBACK');throw e;}
      }
      return result!;
    } catch(error:any) {
      sql.prepare('UPDATE calendar_operations SET last_error = ? WHERE id = ?').run(String(error.message || error).slice(0,500),id);
      if (!op.last_error) this.db.alerts.create({type:'system_error',title:'Calendar operation needs reconciliation',details:`Operation ${id} remains pending. Its slot is reserved; check calendar before changing it.`});
      throw error;
    } finally {this.activeOperations.delete(id);}
  }
  private finishOperation(op:any):void {
    this.db.appDb.db.prepare('DELETE FROM calendar_operations WHERE id = ?').run(op.id);
    if (op.reservation_id) this.db.appDb.db.prepare('DELETE FROM scheduling_reservations WHERE id = ?').run(op.reservation_id);
  }
  private reconciling=false;
  public async reconcileCalendarOperations():Promise<void> {
    if (this.reconciling) return;this.reconciling=true;
    try {
      for (const op of this.db.appDb.db.prepare('SELECT id FROM calendar_operations ORDER BY created_at,rowid').all()) {
        try {await this.applyCalendarOperation(String(op.id));} catch { /* Retain operation and slot until provider recovers. */ }
      }
    } finally {this.reconciling=false;}
  }
}
