import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Customer } from '../../types/index.js';
import { SupabaseSync } from '../supabase.js';

export function normalizePhone(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const trimmed = raw.trim().replace(/^whatsapp:/i, '');
  if (!/^[+\d\s().-]+$/.test(trimmed)) return '';
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (!trimmed.startsWith('+')) {
    if (digits.length === 7 && digits.startsWith('3')) digits = '961' + digits;
    else if (digits.length === 8 && /^(03|7|8)/.test(digits)) digits = '961' + digits.replace(/^0/, '');
  }
  if (!/^[1-9]\d{6,14}$/.test(digits)) return '';
  return `whatsapp:+${digits}`;
}

export class CustomerRepository {
  constructor(private db: DatabaseSync, private syncEnabled = true) {}

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
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const digits = normalized.replace(/\D/g, '');
    const row = this.db.prepare(`SELECT * FROM customers
      WHERE phone = ? OR replace(replace(replace(phone, '+', ''), 'whatsapp:', ''), ' ', '') = ?
      ORDER BY updated_at DESC LIMIT 1`).get(normalized, digits) as any;

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
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('Invalid phone number');
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

    if (this.syncEnabled) SupabaseSync.syncCustomer(newCustomer).catch(() => {});
    return newCustomer;
  }

  public updateName(id: string, name: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE customers SET name = ?, updated_at = ? WHERE id = ?
    `).run(name, now, id);

    const cust = this.findById(id);
    if (cust && this.syncEnabled) SupabaseSync.syncCustomer(cust).catch(() => {});
  }

  public updatePhone(id: string, phone: string): void {
    phone = normalizePhone(phone);
    if (!phone) throw new Error('Invalid phone number');
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE customers SET phone = ?, updated_at = ? WHERE id = ?
    `).run(phone, now, id);

    const cust = this.findById(id);
    if (cust && this.syncEnabled) SupabaseSync.syncCustomer(cust).catch(() => {});
  }

  public setOptOut(id: string, optedOut: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE customers SET opted_out = ?, updated_at = ? WHERE id = ?
    `).run(optedOut ? 1 : 0, now, id);

    const cust = this.findById(id);
    if (cust && this.syncEnabled) SupabaseSync.syncCustomer(cust).catch(() => {});
  }
}
