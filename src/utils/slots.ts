/**
 * Collapses a sorted list of available slot start times (HH:mm, 30-min grid) into
 * contiguous free windows ("From HH:mm to HH:mm"). Each slot represents a 1-hour
 * appointment, so two adjacent 30-min slots (e.g. 09:00 and 09:30) form a window
 * from 09:00 to 10:30 (end of the last slot's appointment).
 *
 * This gives Gemini pre-computed "From X to Y" spans so it can say
 * "From 9:00 AM to 5:00 PM" instead of listing every individual slot.
 */
export function computeFreeWindows(
  slots: string[],
  slotDurationMinutes: number = 60
): Array<{ from: string; to: string; from12: string; to12: string }> {
  if (!slots || slots.length === 0) return [];

  const toMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const to12h = (t: string): string => {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  const toHHmm = (totalMinutes: number): string => {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const step = 30; // grid step in minutes
  const windows: Array<{ from: string; to: string; from12: string; to12: string }> = [];
  let windowStart = slots[0];
  let prevStartMin = toMinutes(slots[0]);

  for (let i = 1; i < slots.length; i++) {
    const currMin = toMinutes(slots[i]);
    if (currMin - prevStartMin > step) {
      // Gap detected — close the current window at end of previous slot's appointment
      const windowEndMin = prevStartMin + slotDurationMinutes;
      const endStr = toHHmm(windowEndMin);
      windows.push({ from: windowStart, to: endStr, from12: to12h(windowStart), to12: to12h(endStr) });
      windowStart = slots[i];
    }
    prevStartMin = currMin;
  }

  // Close the final window
  const windowEndMin = toMinutes(slots[slots.length - 1]) + slotDurationMinutes;
  const endStr = toHHmm(windowEndMin);
  windows.push({ from: windowStart, to: endStr, from12: to12h(windowStart), to12: to12h(endStr) });

  return windows;
}
