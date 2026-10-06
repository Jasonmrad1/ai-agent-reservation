import {it,expect} from 'vitest';import {GoogleCalendarProvider} from '../src/calendar/provider.js';import {getBeirutTimeInfo} from '../src/utils/timezone.js';
it('blocks an all-day calendar event even when Beirut skips midnight for DST',async()=>{
 const p=new GoogleCalendarProvider({clientId:'id',clientSecret:'secret',refreshToken:'token',calendarId:'clinic'});(p as any).getClient=async()=>({events:{list:async()=>({data:{items:[{id:'day',start:{date:'2026-03-29'},end:{date:'2026-03-30'}}]}})}});
 const events=await p.listEvents(new Date('2026-03-28'),new Date('2026-03-31'));expect(events).toHaveLength(1);expect(getBeirutTimeInfo(events[0].start).dateStr).toBe('2026-03-29');
});
