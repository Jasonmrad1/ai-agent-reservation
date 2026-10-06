import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Appointment, AppointmentStatus, VisitType } from '../../types/index.js';

export class AppointmentRepository {
  constructor(private db: DatabaseSync, private syncEnabled = true) {}

  public create(data: {
    customer_id: string;
    visit_type: VisitType;
    address?: string | null;
    service: string;
    price: number;
    start_time: string;
    end_time: string;
    status?: AppointmentStatus;
    google_event_id?: string | null;
    notes?: string | null;
  }): Appointment {
    const now = new Date().toISOString();
    const appt: Appointment = {
      id: crypto.randomUUID(),
      customer_id: data.customer_id,
      visit_type: data.visit_type,
      address: data.address || null,
      service: data.service,
      price: data.price ?? 0,
      start_time: data.start_time,
      end_time: data.end_time,
      status: data.status || 'booked',
      google_event_id: data.google_event_id || null,
      reminder_24h_sent: false,
      reminder_1h_sent: false,
      notes: data.notes || null,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO appointments (
        id, customer_id, visit_type, address, service, price,
        start_time, end_time, status, google_event_id,
        reminder_24h_sent, reminder_1h_sent, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      appt.id,
      appt.customer_id,
      appt.visit_type,
      appt.address ?? null,
      appt.service,
      appt.price,
      appt.start_time,
      appt.end_time,
      appt.status,
      appt.google_event_id ?? null,
      appt.reminder_24h_sent ? 1 : 0,
      appt.reminder_1h_sent ? 1 : 0,
      appt.notes ?? null,
      appt.created_at,
      appt.updated_at
    );

    return appt;
  }

  public findById(id: string): Appointment | null {
    const row = this.db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findByGoogleEventId(eventId: string): Appointment | null {
    const row = this.db.prepare('SELECT * FROM appointments WHERE google_event_id = ?').get(eventId) as any;
    if (!row) return null;
    return this.mapRow(row);
  }


  public findLatestActiveByCustomerId(customerId: string): Appointment | null {
    const row = this.db.prepare(`
      SELECT * FROM appointments
      WHERE customer_id = ? AND status IN ('booked', 'confirmed', 'rescheduled') AND start_time > ?
      ORDER BY start_time ASC
      LIMIT 1
    `).get(customerId, new Date().toISOString()) as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  public findLatestActiveByCustomerOrPhone(customerId: string, phone?: string): Appointment | null {
    return this.findLatestActiveByCustomerId(customerId);
  }

  public findUpcomingByCustomerId(customerId: string, _phone?: string): Appointment[] {
    const rows = this.db.prepare(`SELECT * FROM appointments
      WHERE customer_id = ? AND status IN ('booked', 'confirmed', 'rescheduled') AND start_time > ?
      ORDER BY start_time ASC`).all(customerId, new Date().toISOString()) as any[];
    return rows.map(this.mapRow);
  }

  public getAppointmentsInRange(startTime: string, endTime: string): Appointment[] {
    const rows = this.db.prepare(`
      SELECT * FROM appointments
      WHERE status IN ('booked', 'confirmed', 'rescheduled')
        AND start_time < ?
        AND end_time > ?
      ORDER BY start_time ASC
    `).all(endTime, startTime) as any[];

    return rows.map(this.mapRow);
  }

  public listUpcoming(limit: number = 50): (Appointment & { customer_name?: string; customer_phone?: string })[] {
    const rows = this.db.prepare(`
      SELECT a.*, c.name as customer_name, c.phone as customer_phone
      FROM appointments a
      JOIN customers c ON a.customer_id = c.id
      WHERE a.status IN ('booked', 'confirmed', 'rescheduled') AND a.start_time > ?
      ORDER BY a.start_time ASC
      LIMIT ?
    `).all(new Date().toISOString(), limit) as any[];

    return rows.map((r) => ({
      ...this.mapRow(r),
      customer_name: r.customer_name,
      customer_phone: r.customer_phone,
    }));
  }

  public updateAddress(id: string, address: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE appointments SET address = ?, updated_at = ? WHERE id = ?
    `).run(address, now, id);

    const appt = this.findById(id);
  }

  public update(id: string, updates: Partial<Appointment>): void {
    const appt = this.findById(id);
    if (!appt) return;
    const updated: Appointment = {
      ...appt,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.db.prepare(`
      UPDATE appointments SET
        visit_type = ?,
        address = ?,
        service = ?,
        price = ?,
        start_time = ?,
        end_time = ?,
        status = ?,
        google_event_id = ?,
        reminder_24h_sent = ?,
        reminder_1h_sent = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updated.visit_type,
      updated.address ?? null,
      updated.service,
      updated.price,
      updated.start_time,
      updated.end_time,
      updated.status,
      updated.google_event_id ?? null,
      updated.reminder_24h_sent ? 1 : 0,
      updated.reminder_1h_sent ? 1 : 0,
      updated.notes ?? null,
      updated.updated_at,
      id
    );
  }

  public updateStatus(id: string, status: AppointmentStatus): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, now, id);

    const appt = this.findById(id);
  }

  public reschedule(
    id: string,
    startTime: string,
    endTime: string,
    visitType?: VisitType,
    address?: string | null
  ): void {
    const now = new Date().toISOString();
    const appt = this.findById(id);
    if (!appt) return;

    this.db.prepare(`
      UPDATE appointments
      SET start_time = ?, end_time = ?, visit_type = ?, address = ?,
          status = 'rescheduled', reminder_24h_sent = 0, reminder_1h_sent = 0, updated_at = ?
      WHERE id = ?
    `).run(
      startTime,
      endTime,
      visitType || appt.visit_type,
      address !== undefined ? (address ?? null) : (appt.address ?? null),
      now,
      id
    );

    const updated = this.findById(id);
  }

  public cancel(id: string, notes?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE appointments SET status = 'cancelled', notes = ?, updated_at = ? WHERE id = ?
    `).run(notes || 'Cancelled by customer', now, id);

    const appt = this.findById(id);
  }

  public setGoogleEventId(id: string, googleEventId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE appointments SET google_event_id = ?, updated_at = ? WHERE id = ?
    `).run(googleEventId, now, id);
  }

  public markReminderSent(id: string, type: '24h' | '1h'): void {
    const now = new Date().toISOString();
    const col = type === '24h' ? 'reminder_24h_sent' : 'reminder_1h_sent';
    this.db.prepare(`
      UPDATE appointments SET ${col} = 1, updated_at = ? WHERE id = ?
    `).run(now, id);
  }

  public getPendingReminders(type: '24h' | '1h', now: Date = new Date()): (Appointment & { customer_phone: string; customer_name: string | null })[] {
    const nowMs = now.getTime();
    let minTarget: number;
    let maxTarget: number;

    if (type === '24h') {
      // 24 hours from now ± 60 minutes window
      minTarget = nowMs + 80 * 60 * 1000 + 1;
      maxTarget = nowMs + 25 * 60 * 60 * 1000;
    } else {
      // 1 hour from now ± 20 minutes window
      minTarget = nowMs + 1;
      maxTarget = nowMs + 80 * 60 * 1000;
    }

    const minIso = new Date(minTarget).toISOString();
    const maxIso = new Date(maxTarget).toISOString();
    const flagCol = type === '24h' ? 'reminder_24h_sent' : 'reminder_1h_sent';

    const rows = this.db.prepare(`
      SELECT a.*, c.phone as customer_phone, c.name as customer_name
      FROM appointments a
      JOIN customers c ON a.customer_id = c.id
      WHERE a.status IN ('booked', 'confirmed', 'rescheduled')
        AND a.${flagCol} = 0
        AND a.start_time >= ?
        AND a.start_time <= ?
        AND c.opted_out = 0
    `).all(minIso, maxIso) as any[];

    return rows.map((r) => ({
      ...this.mapRow(r),
      customer_phone: r.customer_phone,
      customer_name: r.customer_name,
    }));
  }

  private mapRow(row: any): Appointment {
    return {
      id: row.id,
      customer_id: row.customer_id,
      visit_type: row.visit_type as VisitType,
      address: row.address,
      service: row.service,
      price: Number(row.price),
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status as AppointmentStatus,
      google_event_id: row.google_event_id,
      reminder_24h_sent: Boolean(row.reminder_24h_sent),
      reminder_1h_sent: Boolean(row.reminder_1h_sent),
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
