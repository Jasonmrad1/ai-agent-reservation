import { DatabaseSync } from 'node:sqlite';
import { SupabaseSync } from '../supabase.js';

export class SettingsRepository {
  constructor(private db: DatabaseSync) {}

  public get(key: string, defaultValue: string = ''): string {
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row ? row.value : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  public set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);

    SupabaseSync.syncSetting(key, value).catch(() => {});
  }

  public getAll(): Record<string, string> {
    try {
      const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
      const result: Record<string, string> = {};
      for (const r of rows) {
        result[r.key] = r.value;
      }
      return result;
    } catch {
      return {};
    }
  }
}
