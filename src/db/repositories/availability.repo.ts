import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { AvailabilityRule, AvailabilityOverride, TimeInterval } from '../../types/index.js';

export class AvailabilityRepository {
  constructor(private db: DatabaseSync, private syncEnabled = true) {}

  private parseShifts(rawJson: string | null | undefined, fallbackStart: string, fallbackEnd: string): TimeInterval[] {
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s: any) => ({
            start_time: String(s.start_time),
            end_time: String(s.end_time),
          }));
        }
      } catch {}
    }
    return [{ start_time: fallbackStart, end_time: fallbackEnd }];
  }

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
      shifts: this.parseShifts(r.shifts, r.start_time, r.end_time),
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
      shifts: this.parseShifts(row.shifts, row.start_time, row.end_time),
    };
  }

  public updateRule(
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    isActive: boolean,
    shifts?: TimeInterval[]
  ): void {
    const existing = this.getRuleForDay(dayOfWeek);
    const validShifts = shifts && shifts.length > 0 ? shifts : [{ start_time: startTime, end_time: endTime }];
    const shiftsJson = JSON.stringify(validShifts);

    // Compute span: earliest start and latest end
    const sortedStarts = [...validShifts].map(s => s.start_time).sort();
    const sortedEnds = [...validShifts].map(s => s.end_time).sort();
    const spanStart = sortedStarts[0] || startTime;
    const spanEnd = sortedEnds[sortedEnds.length - 1] || endTime;

    if (existing) {
      this.db.prepare(`
        UPDATE availability_rules
        SET start_time = ?, end_time = ?, is_active = ?, shifts = ?
        WHERE day_of_week = ?
      `).run(spanStart, spanEnd, isActive ? 1 : 0, shiftsJson, dayOfWeek);
    } else {
      this.db.prepare(`
        INSERT INTO availability_rules (id, day_of_week, start_time, end_time, is_active, shifts)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), dayOfWeek, spanStart, spanEnd, isActive ? 1 : 0, shiftsJson);
    }

    const updated = this.getRuleForDay(dayOfWeek);
  }

  public updateRulesBatch(
    rules: Array<{ day_of_week: number; start_time: string; end_time: string; is_active: boolean; shifts?: TimeInterval[] }>
  ): void {
    for (const rule of rules) {
      this.updateRule(rule.day_of_week, rule.start_time, rule.end_time, rule.is_active, rule.shifts);
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
      shifts: r.shifts ? this.parseShifts(r.shifts, r.start_time || '09:00', r.end_time || '17:00') : undefined,
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
      shifts: row.shifts ? this.parseShifts(row.shifts, row.start_time || '09:00', row.end_time || '17:00') : undefined,
    };
  }

  public setOverride(override: {
    date: string;
    is_unavailable: boolean;
    start_time?: string | null;
    end_time?: string | null;
    reason?: string | null;
    shifts?: TimeInterval[];
  }): AvailabilityOverride {
    const existing = this.getOverrideForDate(override.date);
    const shiftsJson = override.shifts && override.shifts.length > 0 ? JSON.stringify(override.shifts) : null;

    if (existing) {
      this.db.prepare(`
        UPDATE availability_overrides
        SET is_unavailable = ?, start_time = ?, end_time = ?, reason = ?, shifts = ?
        WHERE date = ?
      `).run(
        override.is_unavailable ? 1 : 0,
        override.start_time || null,
        override.end_time || null,
        override.reason || null,
        shiftsJson,
        override.date
      );
      const res = { ...existing, ...override };
      return res;
    }

    const newOverride: AvailabilityOverride = {
      id: crypto.randomUUID(),
      date: override.date,
      is_unavailable: override.is_unavailable,
      start_time: override.start_time || null,
      end_time: override.end_time || null,
      reason: override.reason || null,
      shifts: override.shifts,
    };

    this.db.prepare(`
      INSERT INTO availability_overrides (id, date, is_unavailable, start_time, end_time, reason, shifts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      newOverride.id,
      newOverride.date,
      newOverride.is_unavailable ? 1 : 0,
      newOverride.start_time ?? null,
      newOverride.end_time ?? null,
      newOverride.reason ?? null,
      shiftsJson
    );

    return newOverride;
  }

  public deleteOverride(id: string): void {
    this.db.prepare('DELETE FROM availability_overrides WHERE id = ?').run(id);
  }

  public deleteOverridesInRange(startDate: string, endDate: string): void {
    const rows = this.db.prepare(`
      SELECT id FROM availability_overrides
      WHERE date >= ? AND date <= ?
    `).all(startDate, endDate) as any[];

    for (const r of rows) {
      this.deleteOverride(r.id);
    }
  }
}
