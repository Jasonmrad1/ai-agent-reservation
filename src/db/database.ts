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
