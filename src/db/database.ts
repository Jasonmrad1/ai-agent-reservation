import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SCHEMA_SQL, DEFAULT_WEEKLY_AVAILABILITY } from './schema.js';

export class AppDatabase {
  public db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA_SQL);
    const legacyAppointments=(this.db.prepare('SELECT count(*) AS n FROM appointments').get() as any).n;
    this.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('timezone_storage_version',?)").run(legacyAppointments ? 'legacy-review' : 'utc-v1');

    // Safe column migrations for existing SQLite databases
    try {
      this.db.exec('ALTER TABLE availability_rules ADD COLUMN shifts TEXT;');
    } catch {}
    try {
      this.db.exec('ALTER TABLE availability_overrides ADD COLUMN shifts TEXT;');
    } catch {}

    for(const column of ['options TEXT','idempotency_key TEXT']) {try {this.db.exec('ALTER TABLE outbound_jobs ADD COLUMN '+column);}catch{}}
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS outbound_idempotency ON outbound_jobs(idempotency_key)');

    const duplicates=this.db.prepare('SELECT appointment_id FROM invoices GROUP BY appointment_id HAVING count(*)>1').all();
    if(!duplicates.length) this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS one_invoice_per_appointment ON invoices(appointment_id)');

    // Ensure default settings
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('home_visit_buffer_minutes', '30')
      `).run();
    } catch {}

    // Seed default weekly availability if table is empty
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM availability_rules').get() as { cnt: number };
    if (countRow.cnt === 0) {
      const insert = this.db.prepare(`
        INSERT INTO availability_rules (id, day_of_week, start_time, end_time, is_active)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const rule of DEFAULT_WEEKLY_AVAILABILITY) {
        insert.run(crypto.randomUUID(), rule.day_of_week, rule.start_time, rule.end_time, rule.is_active);
      }
    }
  }

  public close(): void {
    this.db.close();
  }
}
