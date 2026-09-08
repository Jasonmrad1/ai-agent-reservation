import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Conversation } from '../../types/index.js';

export class ConversationRepository {
  constructor(private db: DatabaseSync) {}

  public findActiveByCustomerId(customerId: string): Conversation | null {
    const row = this.db.prepare(`
      SELECT * FROM conversations 
      WHERE customer_id = ? AND status != 'closed'
      ORDER BY updated_at DESC LIMIT 1
    `).get(customerId) as any;

    if (!row) return null;
    return {
      id: row.id,
      customer_id: row.customer_id,
      channel: row.channel,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  public getOrCreateActive(customerId: string): Conversation {
    const existing = this.findActiveByCustomerId(customerId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const newConv: Conversation = {
      id: crypto.randomUUID(),
      customer_id: customerId,
      channel: 'whatsapp',
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO conversations (id, customer_id, channel, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newConv.id,
      newConv.customer_id,
      newConv.channel,
      newConv.status,
      newConv.created_at,
      newConv.updated_at
    );

    return newConv;
  }

  public updateStatus(id: string, status: 'active' | 'escalated' | 'doctor_active' | 'closed'): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, now, id);
  }

  public touch(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ?
    `).run(now, id);
  }
}
