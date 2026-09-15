import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
import { getBeirutTimeInfo, getBeirutTodayStr } from '../src/utils/timezone.js';
import { computeFreeWindows } from '../src/utils/slots.js';
import { parseDateTimeFromMessage } from '../src/gemini/agent.js';

describe('🇱🇧 BEIRUT TIMEZONE & SAME-DAY PAST SLOTS FILTERING', () => {
  let db: DatabaseContext;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    calendar = new InMemoryCalendarProvider();
    scheduler = new SchedulingEngine({ db, calendar, homeVisitBufferMinutes: 30, defaultSlotDurationMinutes: 60 });
  });

  it('1. Correctly formats and calculates Beirut local date, hour, minute, and totalMinutes', () => {
    // 2026-09-15 11:05:00 UTC is 14:05:00 in Beirut (UTC+3 DST)
    const testDateUtc = new Date('2026-09-15T11:05:00.000Z');
    const info = getBeirutTimeInfo(testDateUtc);

    expect(info.dateStr).toBe('2026-09-15');
    expect(info.hour).toBe(14);
    expect(info.minute).toBe(5);
    expect(info.totalMinutes).toBe(14 * 60 + 5);
    expect(info.dayName).toBe('Tuesday');
    expect(info.timeStr24).toBe('14:05');
    expect(info.timeStr12).toBe('2:05 PM');
  });

  it('2. Filters out passed slots on the same day when queried at 2:01 PM (14:01)', async () => {
    // Setup clinic hours for Tuesday: 09:00 to 18:00
    db.availability.updateRule(2, '09:00', '18:00', true, [
      { start_time: '13:15', end_time: '18:00' },
    ]);

    // Simulated Beirut current time: Tuesday 2026-09-15 at 14:01 (2:01 PM) Beirut time (11:01 UTC)
    const mockNow = new Date('2026-09-15T11:01:00.000Z');

    const slots = await scheduler.getAvailableSlots('2026-09-15', 'in_office', 60, mockNow);

    // 13:15, 13:30, 14:00 are in the past (< 14:01) -> must be excluded!
    expect(slots).not.toContain('13:15');
    expect(slots).not.toContain('13:30');
    expect(slots).not.toContain('14:00');

    // Future slots starting at or after 14:30 must be present
    expect(slots).toContain('14:30');
    expect(slots).toContain('15:00');
    expect(slots).toContain('15:30');
    expect(slots).toContain('16:00');
    expect(slots).toContain('16:30');
    expect(slots).toContain('17:00');

    const windows = computeFreeWindows(slots, 60);
    expect(windows.length).toBeGreaterThan(0);
    // The window must start from 2:30 PM (14:30), not from 1:15 PM!
    expect(windows[0].from).toBe('14:30');
    expect(windows[0].from12).toBe('2:30 PM');
    expect(windows[0].to).toBe('18:00');
    expect(windows[0].to12).toBe('6:00 PM');
  });

  it('3. Preserves morning slots for upcoming days (e.g. tomorrow)', async () => {
    // Setup clinic hours for Wednesday: 09:00 to 18:00
    db.availability.updateRule(3, '09:00', '18:00', true);

    // Current time: Tuesday 14:01
    const mockNow = new Date('2026-09-15T11:01:00.000Z');

    // Query for tomorrow (Wednesday 2026-09-16)
    const slots = await scheduler.getAvailableSlots('2026-09-16', 'in_office', 60, mockNow);

    // Tomorrow morning slots should all be available
    expect(slots).toContain('09:00');
    expect(slots).toContain('09:30');
    expect(slots).toContain('10:00');
  });

  it('4. Multi-range schedule correctly clips today while showing full days ahead', async () => {
    // Setup rules for Mon-Fri 09:00-17:00
    for (let d = 1; d <= 5; d++) {
      db.availability.updateRule(d, '09:00', '17:00', true);
    }

    // Tuesday at 15:15 Beirut time (3:15 PM)
    const mockNow = new Date('2026-09-15T12:15:00.000Z');

    const range = await scheduler.getAvailableSlotsAcrossRange('2026-09-15', 3, 'in_office', 3, mockNow);

    const todayReport = range.find((r) => r.date === '2026-09-15')!;
    expect(todayReport.available_slots).not.toContain('09:00');
    expect(todayReport.available_slots).not.toContain('12:00');
    expect(todayReport.available_slots).not.toContain('15:00');
    expect(todayReport.available_slots).toContain('15:30');
    expect(todayReport.available_slots).toContain('16:00');

    const tomorrowReport = range.find((r) => r.date === '2026-09-16')!;
    expect(tomorrowReport.available_slots).toContain('09:00');
    expect(tomorrowReport.available_slots).toContain('10:00');
  });

  it('5. Relative Arabizi date parsing (bkra, taleta, arba3a) accurately anchors to Beirut timezone', () => {
    // Tuesday 2026-09-15 14:00 Beirut time
    const mockNow = new Date('2026-09-15T11:00:00.000Z');

    const parsedBkra = parseDateTimeFromMessage('bde maw3ad bkra 3al 10', mockNow);
    expect(parsedBkra?.date).toBe('2026-09-16');
    expect(parsedBkra?.time).toBe('10:00');

    const parsedLyom = parseDateTimeFromMessage('maw3ad lyom se3a 4:30 pm', mockNow);
    expect(parsedLyom?.date).toBe('2026-09-15');
    expect(parsedLyom?.time).toBe('16:30');

    const parsedKhamis = parseDateTimeFromMessage('khamis 11 am', mockNow);
    expect(parsedKhamis?.date).toBe('2026-09-17');
    expect(parsedKhamis?.time).toBe('11:00');
  });
});
