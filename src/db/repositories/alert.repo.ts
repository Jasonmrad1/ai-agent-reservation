import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { AdminAlert, AlertType, AlertStatus } from '../../types/index.js';

export class AdminAlertRepository {
  constructor(private db: DatabaseSync) {}

  public create(data: {
    type: AlertType;
    title: string;
    details: string;
    customer_id?: string | null;
  }): AdminAlert {
    const now = new Date().toISOString();
    const alert: AdminAlert = {
      id: crypto.randomUUID(),
      type: data.type,
      title: data.title,
      details: data.details,
      customer_id: data.customer_id || null,
      status: 'pending',
      created_at: now,
      resolved_at: null,
    };

    this.db.prepare(`
      INSERT INTO admin_alerts (id, type, title, details, customer_id, status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      alert.id,
      alert.type,
      alert.title,
      alert.details,
      alert.customer_id ?? null,
      alert.status,
      alert.created_at,
      alert.resolved_at ?? null
    );

    return alert;
  }

  public listPending(): AdminAlert[] {
    const rows = this.db.prepare(`
      SELECT * FROM admin_alerts
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `).all() as any[];

    return rows.map((r) => ({
      id: r.id,
      type: r.type as AlertType,
      title: r.title,
      details: r.details,
      customer_id: r.customer_id,
      status: r.status as AlertStatus,
      created_at: r.created_at,
      resolved_at: r.resolved_at,
    }));
  }

  public listAll(limit: number = 50): AdminAlert[] {
    const rows = this.db.prepare(`
      SELECT * FROM admin_alerts
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      type: r.type as AlertType,
      title: r.title,
      details: r.details,
      customer_id: r.customer_id,
      status: r.status as AlertStatus,
      created_at: r.created_at,
      resolved_at: r.resolved_at,
    }));
  }

  public resolve(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE admin_alerts SET status = 'resolved', resolved_at = ? WHERE id = ?
    `).run(now, id);
  }
}
