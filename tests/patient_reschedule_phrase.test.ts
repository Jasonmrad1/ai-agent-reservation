import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';
import {clinicIso} from './clinic-time.js';

it.each(['move my appointment to September 15 at 2pm','reschedule to September 15 at 2pm'])('moves to the requested date and time for "%s"',async phrase=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});
 const phone='+96171000895';
 const send=(Body:string,MessageSid:string)=>request(a.app).post('/api/webhook/whatsapp').send({From:phone,Body,MessageSid});
 try {
  expect((await send('Book in clinic September 14 at 11am','SM_PHRASE_BOOK')).status).toBe(200);
  const c=a.db.customers.findByPhone(phone)!;const appt=a.db.appointments.findUpcomingByCustomerId(c.id)[0];
  expect(appt.start_time).toBe(clinicIso('2026-09-14T11:00:00Z'));
  expect((await send(phrase,'SM_PHRASE_CANCEL')).status).toBe(200);
  const updated=a.db.appointments.findById(appt.id)!;
  expect(updated.status).toBe('rescheduled');
  expect(updated.start_time).toBe(clinicIso('2026-09-15T14:00:00Z'));
  expect(a.db.appointments.findUpcomingByCustomerId(c.id)).toHaveLength(1);
  expect((a.gateway as any).sentMessages.at(-1).body).toMatch(/rescheduled/i);
  const events=await a.calendar.listEvents(new Date('2026-09-01'),new Date('2026-10-01'));
  expect(events).toHaveLength(1);expect(events[0].start.toISOString()).toBe(updated.start_time);
 } finally {a.db.appDb.close();a.simulator.db.appDb.close();}
});
