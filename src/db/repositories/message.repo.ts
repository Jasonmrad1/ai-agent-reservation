import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Message, MessageDirection } from '../../types/index.js';

export class MessageRepository {
  constructor(private db: DatabaseSync) {}

  public create(
    conversationId: string,
    direction: MessageDirection,
    body: string,
    messageSid?: string | null,
    status: 'received' | 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered' = 'received',
    rawPayload?: any
  ): Message {
    if (messageSid) {const existing=this.findByMessageSid(messageSid);if(existing) return existing;}
    const now = new Date().toISOString();
    const msg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      direction,
      body,
      message_sid: messageSid || null,
      status,
      raw_payload: rawPayload ? JSON.stringify(rawPayload) : null,
      created_at: now,
    };

    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, direction, body, message_sid, status, raw_payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.conversation_id,
      msg.direction,
      msg.body,
      msg.message_sid ?? null,
      msg.status,
      msg.raw_payload ?? null,
      msg.created_at
    );

    return msg;
  }

  public findByMessageSid(messageSid: string): Message | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE message_sid = ?').get(messageSid) as any;
    if (!row) return null;
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      direction: row.direction,
      body: row.body,
      message_sid: row.message_sid,
      status: row.status,
      raw_payload: row.raw_payload,
      created_at: row.created_at,
    };
  }

  public getRecentMessages(conversationId: string, limit: number = 20): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(conversationId, limit) as any[];

    return rows.reverse().map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      direction: row.direction,
      body: row.body,
      message_sid: row.message_sid,
      status: row.status,
      raw_payload: row.raw_payload,
      created_at: row.created_at,
    }));
  }

  public updateStatusBySid(messageSid: string, status: Message['status']): void {
    this.db.prepare(`
      UPDATE messages SET status = ? WHERE message_sid = ?
    `).run(status, messageSid);
  }
}
