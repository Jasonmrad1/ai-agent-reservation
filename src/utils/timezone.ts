/**
 * Beirut Timezone (Asia/Beirut - Eastern European Time UTC+2 / UTC+3 DST) Utilities.
 * Ensures consistent clinic clock time across all environments (Docker, Railway, Render, Local).
 */

export const BEIRUT_TIMEZONE = 'Asia/Beirut';

export interface BeirutTimeInfo {
  dateStr: string; // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  totalMinutes: number; // hour * 60 + minute
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  dayName: string; // Sunday, Monday, ...
  timeStr24: string; // HH:mm
  timeStr12: string; // h:mm A
}

export function getBeirutTimeInfo(date: Date = new Date()): BeirutTimeInfo {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIRUT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';

  const year = parseInt(getPart('year'), 10);
  const month = parseInt(getPart('month'), 10);
  const day = parseInt(getPart('day'), 10);
  const hour = parseInt(getPart('hour'), 10);
  const minute = parseInt(getPart('minute'), 10);
  const second = parseInt(getPart('second'), 10);

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const totalMinutes = hour * 60 + minute;
  const timeStr24 = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const timeStr12 = `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;

  // Calculate day of week in Beirut timezone
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = d.getUTCDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[dayOfWeek];

  return {
    dateStr,
    year,
    month,
    day,
    hour,
    minute,
    second,
    totalMinutes,
    dayOfWeek,
    dayName,
    timeStr24,
    timeStr12,
  };
}

export function getBeirutTodayStr(date: Date = new Date()): string {
  return getBeirutTimeInfo(date).dateStr;
}
