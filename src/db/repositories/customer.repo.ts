import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Customer } from '../../types/index.js';

export class CustomerRepository {
  constructor(private db: DatabaseSync) {}

  public findById(id: string): Customer | null {
    const row = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      phone: row.phone,
      name: row.name,
      opted_out: Boolean(row.opted_out),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  public findByPhone(phone: string): Customer | null {
    const row = this.db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone) as any;
    if (!row) return null;
    return {
      id: row.id,
      phone: row.phone,
      name: row.name,
      opted_out: Boolean(row.opted_out),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  public findOrCreate(phone: string, name?: string | null): Customer {
    const existing = this.findByPhone(phone);
    if (existing) {
      if (name && name !== existing.name) {
        this.updateName(existing.id, name);
        existing.name = name;
      }
      return existing;
    }

    const now = new Date().toISOString();
    const newCustomer: Customer = {
      id: crypto.randomUUID(),
      phone,
      name: name || null,
      opted_out: false,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO customers (id, phone, name, opted_out, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newCustomer.id,
      newCustomer.phone,
      newCustomer.name ?? null,
      newCustomer.opted_out ? 1 : 0,
      newCustomer.created_at,
      newCustomer.updated_at
    );

    return newCustomer;
  }

  public updateName(id: string, name: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE customers SET name = ?, updated_at = ? WHERE id = ?
    `).run(name, now, id);
  }

  public setOptOut(id: string, optedOut: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE customers SET opted_out = ?, updated_at = ? WHERE id = ?
    `).run(optedOut ? 1 : 0, now, id);
  }
}
