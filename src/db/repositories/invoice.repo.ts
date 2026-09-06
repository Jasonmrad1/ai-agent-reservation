import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Invoice, InvoiceStatus } from '../../types/index.js';

export class InvoiceRepository {
  constructor(private db: DatabaseSync) {}

  public create(data: {
    appointment_id: string;
    customer_id: string;
    service_description: string;
    amount: number;
    currency?: string;
    payment_link?: string | null;
  }): Invoice {
    const now = new Date().toISOString();
    const invoice: Invoice = {
      id: crypto.randomUUID(),
      appointment_id: data.appointment_id,
      customer_id: data.customer_id,
      service_description: data.service_description,
      amount: data.amount,
      currency: data.currency || 'USD',
      status: 'unpaid',
      payment_link: data.payment_link || null,
      created_at: now,
      paid_at: null,
    };

    this.db.prepare(`
      INSERT INTO invoices (
        id, appointment_id, customer_id, service_description,
        amount, currency, status, payment_link, created_at, paid_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoice.id,
      invoice.appointment_id,
      invoice.customer_id,
      invoice.service_description,
      invoice.amount,
      invoice.currency,
      invoice.status,
      invoice.payment_link ?? null,
      invoice.created_at,
      invoice.paid_at ?? null
    );

    return invoice;
  }

  public findById(id: string): Invoice | null {
    const row = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findByAppointmentId(appointmentId: string): Invoice | null {
    const row = this.db.prepare('SELECT * FROM invoices WHERE appointment_id = ?').get(appointmentId) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public listAll(limit: number = 50): (Invoice & { customer_name?: string; customer_phone?: string })[] {
    const rows = this.db.prepare(`
      SELECT i.*, c.name as customer_name, c.phone as customer_phone
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      ORDER BY i.created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((r) => ({
      ...this.mapRow(r),
      customer_name: r.customer_name,
      customer_phone: r.customer_phone,
    }));
  }

  public markPaid(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?
    `).run(now, id);
  }

  private mapRow(row: any): Invoice {
    return {
      id: row.id,
      appointment_id: row.appointment_id,
      customer_id: row.customer_id,
      service_description: row.service_description,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status as InvoiceStatus,
      payment_link: row.payment_link,
      created_at: row.created_at,
      paid_at: row.paid_at,
    };
  }
}
