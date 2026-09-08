import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Customer } from '../../types/index.js';
import { SupabaseSync } from '../supabase.js';

export function normalizePhone(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (digits.length === 8 && (digits.startsWith('7') || digits.startsWith('8') || digits.startsWith('0') || digits.startsWith('3'))) {
    const cleanLeb = digits.startsWith('0') ? digits.slice(1) : digits;
    return `whatsapp:+961${cleanLeb}`;
  }
  if (digits.startsWith('00')) {
    return `whatsapp:+${digits.slice(2)}`;
  }
  return `whatsapp:+${digits}`;
}

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
    if (!phone) return null;
    const rawClean = phone.trim();
    const normalized = normalizePhone(phone);
    const digits = phone.replace(/\D/g, '');

    const row = this.db.prepare(`
      SELECT * FROM customers 
      WHERE phone = ? 
         OR phone = ? 
         OR phone LIKE ? 
         OR replace(replace(replace(phone, '+', ''), 'whatsapp:', ''), ' ', '') = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(rawClean, normalized, `%${digits}%`, digits) as any;

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
    const normalized = normalizePhone(phone) || phone;
    const existing = this.findByPhone(phone) || this.findByPhone(normalized);
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
      phone: normalized,
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

    SupabaseSync.syncCustomer(newCustomer).catch(() => {});
    return newCustomer;
  }

  public updateName(id: string, name: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE customers SET name = ?, updated_at = ? WHERE id = ?
    `).run(name, now, id);

    const cust = this.findById(id);
    if (cust) SupabaseSync.syncCustomer(cust).catch(() => {});
  }

  public updatePhone(id: string, phone: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE customers SET phone = ?, updated_at = ? WHERE id = ?
    `).run(phone, now, id);

    const cust = this.findById(id);
    if (cust) SupabaseSync.syncCustomer(cust).catch(() => {});
  }

  public setOptOut(id: string, optedOut: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE customers SET opted_out = ?, updated_at = ? WHERE id = ?
    `).run(optedOut ? 1 : 0, now, id);

    const cust = this.findById(id);
    if (cust) SupabaseSync.syncCustomer(cust).catch(() => {});
  }
}
