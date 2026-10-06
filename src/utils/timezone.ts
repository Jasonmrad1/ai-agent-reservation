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
    hourCycle: 'h23',
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

/** Convert a clinic wall time using IANA rules; reject nonexistent or ambiguous DST times. */
export function beirutDateTimeToUtc(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Invalid clinic date or time');
  const [y,m,d] = date.split('-').map(Number); const [h,min] = time.split(':').map(Number);
  const raw = Date.UTC(y,m-1,d,h,min);
  if (new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)!==date || h>24 || min>59 || (h===24 && min!==0)) throw new Error('Invalid clinic date or time');
  const targetDate = h===24 ? new Date(raw).toISOString().slice(0,10) : date;
  const targetTime = h===24 ? '00:00' : time;
  const offsets = new Set<number>();
  for (const hours of [-36,0,36]) {
    const sample = raw + hours*3600000; const i = getBeirutTimeInfo(new Date(sample));
    offsets.add(Date.UTC(i.year,i.month-1,i.day,i.hour,i.minute,i.second)-sample);
  }
  const matches = [...offsets].map(offset=>new Date(raw-offset)).filter(candidate=>{
    const i=getBeirutTimeInfo(candidate); return i.dateStr===targetDate && i.timeStr24===targetTime;
  });
  if (matches.length!==1) throw new Error('Clinic time is ambiguous or nonexistent during daylight saving change; choose another time');
  return matches[0];
}
/** First real instant of a clinic date, including dates whose midnight is skipped. */
export function beirutDayStart(date:string):Date {
 const noon=beirutDateTimeToUtc(date,'12:00').getTime();let low=noon-36*3600000,high=noon;
 while(low<high){const mid=Math.floor((low+high)/2);if(getBeirutTimeInfo(new Date(mid)).dateStr<date)low=mid+1;else high=mid;}
 return new Date(low);
}
