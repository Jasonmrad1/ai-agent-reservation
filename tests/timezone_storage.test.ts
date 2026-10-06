import { it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { MockGeminiClient, formatEnglishDate } from '../src/gemini/agent.js';
import { beirutDateTimeToUtc } from '../src/utils/timezone.js';
it('converts summer and winter clinic time to actual UTC instants', () => {
  expect(beirutDateTimeToUtc('2026-09-14','10:00').toISOString()).toBe('2026-09-14T07:00:00.000Z');
  expect(beirutDateTimeToUtc('2026-12-14','10:00').toISOString()).toBe('2026-12-14T08:00:00.000Z');
});
it('formats real UTC appointment instants in Beirut time', () => {
  expect(formatEnglishDate('2026-09-14T07:00:00Z','2026-09-14T08:00:00Z')).toContain('10:00 AM to 11:00 AM');
});
it('stores the same clinic clock time in the calendar and appointment', async () => {
  const client=new MockGeminiClient(); client.mockToolCall={name:'book_appointment',args:{date:'2026-09-14',time:'10:00',visit_type:'in_office'}};
  const a=createApp({config:{...config,databaseUrl:':memory:'},geminiClient:client});const c=a.db.customers.findOrCreate('+96171000111');const v=a.db.conversations.getOrCreateActive(c.id);
  await a.agent.processMessage({customer:c,conversation:v,incomingText:'book September 14 at 10 am in the clinic',db:a.db});
  const appt=a.db.appointments.findUpcomingByCustomerId(c.id)[0];
  expect(appt.start_time).toBe('2026-09-14T07:00:00.000Z');
  const events=await a.calendar.listEvents(new Date('2026-09-14T00:00:00Z'),new Date('2026-09-15T00:00:00Z'));
  expect(events[0].start.toISOString()).toBe(appt.start_time);
});
