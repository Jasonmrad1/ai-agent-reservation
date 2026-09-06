import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { AvailabilityRule, AvailabilityOverride } from '../../types/index.js';

export class AvailabilityRepository {
  constructor(private db: DatabaseSync) {}

  public getAllRules(): AvailabilityRule[] {
    const rows = this.db.prepare(`
      SELECT * FROM availability_rules
      ORDER BY day_of_week ASC
    `).all() as any[];

    return rows.map((r) => ({
      id: r.id,
      day_of_week: Number(r.day_of_week),
      start_time: r.start_time,
      end_time: r.end_time,
      is_active: Boolean(r.is_active),
    }));
  }

  public getRuleForDay(dayOfWeek: number): AvailabilityRule | null {
    const row = this.db.prepare(`
      SELECT * FROM availability_rules
      WHERE day_of_week = ?
    `).get(dayOfWeek) as any;

    if (!row) return null;
    return {
      id: row.id,
      day_of_week: Number(row.day_of_week),
      start_time: row.start_time,
      end_time: row.end_time,
      is_active: Boolean(row.is_active),
    };
  }

  public updateRule(dayOfWeek: number, startTime: string, endTime: string, isActive: boolean): void {
    const existing = this.getRuleForDay(dayOfWeek);
    if (existing) {
      this.db.prepare(`
        UPDATE availability_rules
        SET start_time = ?, end_time = ?, is_active = ?
        WHERE day_of_week = ?
      `).run(startTime, endTime, isActive ? 1 : 0, dayOfWeek);
    } else {
      this.db.prepare(`
        INSERT INTO availability_rules (id, day_of_week, start_time, end_time, is_active)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), dayOfWeek, startTime, endTime, isActive ? 1 : 0);
    }
  }

  public getAllOverrides(): AvailabilityOverride[] {
    const rows = this.db.prepare(`
      SELECT * FROM availability_overrides
      ORDER BY date ASC
    `).all() as any[];

    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      is_unavailable: Boolean(r.is_unavailable),
      start_time: r.start_time,
      end_time: r.end_time,
      reason: r.reason,
    }));
  }

  public getOverrideForDate(dateStr: string): AvailabilityOverride | null {
    const row = this.db.prepare(`
      SELECT * FROM availability_overrides
      WHERE date = ?
    `).get(dateStr) as any;

    if (!row) return null;
    return {
      id: row.id,
      date: row.date,
      is_unavailable: Boolean(row.is_unavailable),
      start_time: row.start_time,
      end_time: row.end_time,
      reason: row.reason,
    };
  }

  public setOverride(override: {
    date: string;
    is_unavailable: boolean;
    start_time?: string | null;
    end_time?: string | null;
    reason?: string | null;
  }): AvailabilityOverride {
    const existing = this.getOverrideForDate(override.date);
    if (existing) {
      this.db.prepare(`
        UPDATE availability_overrides
        SET is_unavailable = ?, start_time = ?, end_time = ?, reason = ?
        WHERE date = ?
      `).run(
        override.is_unavailable ? 1 : 0,
        override.start_time || null,
        override.end_time || null,
        override.reason || null,
        override.date
      );
      return { ...existing, ...override };
    }

    const newOverride: AvailabilityOverride = {
      id: crypto.randomUUID(),
      date: override.date,
      is_unavailable: override.is_unavailable,
      start_time: override.start_time || null,
      end_time: override.end_time || null,
      reason: override.reason || null,
    };

    this.db.prepare(`
      INSERT INTO availability_overrides (id, date, is_unavailable, start_time, end_time, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newOverride.id,
      newOverride.date,
      newOverride.is_unavailable ? 1 : 0,
      newOverride.start_time ?? null,
      newOverride.end_time ?? null,
      newOverride.reason ?? null
    );

    return newOverride;
  }

  public deleteOverride(id: string): void {
    this.db.prepare('DELETE FROM availability_overrides WHERE id = ?').run(id);
  }
}
