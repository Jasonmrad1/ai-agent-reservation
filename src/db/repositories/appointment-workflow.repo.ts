import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { PendingBookingWorkflow, WorkflowState, VisitType } from '../../types/index.js';
import { SupabaseSync } from '../supabase.js';

export class AppointmentWorkflowRepository {
  constructor(private db: DatabaseSync, private syncEnabled = true) {}

  public create(data: {
    customer_id: string;
    conversation_id: string;
    state?: WorkflowState;
    date?: string | null;
    time?: string | null;
    service?: string | null;
    price?: number | null;
    visit_type?: VisitType | null;
    address?: string | null;
    location_lat?: number | null;
    location_lng?: number | null;
    last_message_sid?: string | null;
    appointment_id?: string | null;
    ttlHours?: number;
  }): PendingBookingWorkflow {
    const now = new Date();
    const ttl = data.ttlHours || 24;
    const expiresAt = new Date(now.getTime() + ttl * 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const workflow: PendingBookingWorkflow = {
      id: crypto.randomUUID(),
      customer_id: data.customer_id,
      conversation_id: data.conversation_id,
      state: data.state || 'collecting_preferences',
      date: data.date || null,
      time: data.time || null,
      service: data.service || null,
      price: data.price ?? null,
      visit_type: data.visit_type || null,
      address: data.address || null,
      location_lat: data.location_lat ?? null,
      location_lng: data.location_lng ?? null,
      last_message_sid: data.last_message_sid || null,
      appointment_id: data.appointment_id || null,
      version: 1,
      expires_at: expiresAt,
      created_at: nowIso,
      updated_at: nowIso,
    };

    this.db.prepare(`
      INSERT INTO pending_booking_workflows (
        id, customer_id, conversation_id, state, date, time, service, price,
        visit_type, address, location_lat, location_lng, last_message_sid,
        appointment_id, version, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflow.id,
      workflow.customer_id,
      workflow.conversation_id,
      workflow.state,
      workflow.date ?? null,
      workflow.time ?? null,
      workflow.service ?? null,
      workflow.price ?? null,
      workflow.visit_type ?? null,
      workflow.address ?? null,
      workflow.location_lat ?? null,
      workflow.location_lng ?? null,
      workflow.last_message_sid ?? null,
      workflow.appointment_id ?? null,
      workflow.version,
      workflow.expires_at,
      workflow.created_at,
      workflow.updated_at
    );

    if (this.syncEnabled) SupabaseSync.syncWorkflow(workflow);
    return workflow;
  }

  public findActiveByCustomerId(customerId: string): PendingBookingWorkflow | null {
    const nowIso = new Date().toISOString();
    const row = this.db.prepare(`
      SELECT * FROM pending_booking_workflows
      WHERE customer_id = ?
        AND state NOT IN ('booked', 'cancelled', 'expired', 'failed')
        AND expires_at > ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(customerId, nowIso) as any;

    return row ? this.mapRow(row) : null;
  }

  public findLatestByCustomerId(customerId: string): PendingBookingWorkflow | null {
    const row = this.db.prepare(`
      SELECT * FROM pending_booking_workflows
      WHERE customer_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(customerId) as any;

    return row ? this.mapRow(row) : null;
  }

  public findById(id: string): PendingBookingWorkflow | null {
    const row = this.db.prepare('SELECT * FROM pending_booking_workflows WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  public update(id: string, updates: Partial<PendingBookingWorkflow>): PendingBookingWorkflow | null {
    const current = this.findById(id);
    if (!current) return null;

    const updated: PendingBookingWorkflow = {
      ...current,
      ...updates,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    };

    this.db.prepare(`
      UPDATE pending_booking_workflows SET
        state = ?,
        date = ?,
        time = ?,
        service = ?,
        price = ?,
        visit_type = ?,
        address = ?,
        location_lat = ?,
        location_lng = ?,
        last_message_sid = ?,
        appointment_id = ?,
        version = ?,
        expires_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updated.state,
      updated.date ?? null,
      updated.time ?? null,
      updated.service ?? null,
      updated.price ?? null,
      updated.visit_type ?? null,
      updated.address ?? null,
      updated.location_lat ?? null,
      updated.location_lng ?? null,
      updated.last_message_sid ?? null,
      updated.appointment_id ?? null,
      updated.version,
      updated.expires_at,
      updated.updated_at,
      id
    );

    if (this.syncEnabled) SupabaseSync.syncWorkflow(updated);
    return updated;
  }

  public transition(id: string, newState: WorkflowState, updates?: Partial<PendingBookingWorkflow>): PendingBookingWorkflow | null {
    return this.update(id, {
      ...(updates || {}),
      state: newState,
    });
  }

  public cancelActiveByCustomerId(customerId: string): void {
    const active = this.findActiveByCustomerId(customerId);
    if (active) {
      this.transition(active.id, 'cancelled');
    }
  }

  public expireOldWorkflows(): number {
    const nowIso = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE pending_booking_workflows
      SET state = 'expired', updated_at = ?
      WHERE state NOT IN ('booked', 'cancelled', 'expired', 'failed')
        AND expires_at <= ?
    `).run(nowIso, nowIso);
    return Number(result.changes);
  }

  public listAll(): PendingBookingWorkflow[] {
    const rows = this.db.prepare('SELECT * FROM pending_booking_workflows ORDER BY updated_at DESC').all() as any[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: any): PendingBookingWorkflow {
    return {
      id: row.id,
      customer_id: row.customer_id,
      conversation_id: row.conversation_id,
      state: row.state as WorkflowState,
      date: row.date || null,
      time: row.time || null,
      service: row.service || null,
      price: row.price != null ? Number(row.price) : null,
      visit_type: (row.visit_type as VisitType) || null,
      address: row.address || null,
      location_lat: row.location_lat != null ? Number(row.location_lat) : null,
      location_lng: row.location_lng != null ? Number(row.location_lng) : null,
      last_message_sid: row.last_message_sid || null,
      appointment_id: row.appointment_id || null,
      version: Number(row.version || 1),
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
