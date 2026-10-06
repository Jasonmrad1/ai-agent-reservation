import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';
import {clinicIso} from './clinic-time.js';

it.each(['cancel my appointment','please cancel my visit'])('cancels rather than booking or moving for "%s"',async phrase=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});
 const phone='+96171000895';
 const send=(Body:string,MessageSid:string)=>request(a.app).post('/api/webhook/whatsapp').send({From:phone,Body,MessageSid});
 try {
  expect((await send('Book in clinic September 14 at 11am','SM_PHRASE_BOOK')).status).toBe(200);
  const c=a.db.customers.findByPhone(phone)!;const appt=a.db.appointments.findUpcomingByCustomerId(c.id)[0];
  expect(appt.start_time).toBe(clinicIso('2026-09-14T11:00:00Z'));
  expect((await send(phrase,'SM_PHRASE_CANCEL')).status).toBe(200);
  expect(a.db.appointments.findById(appt.id)?.status).toBe('cancelled');
  expect(a.db.appointments.findUpcomingByCustomerId(c.id)).toHaveLength(0);
  expect((a.gateway as any).sentMessages.at(-1).body).toMatch(/cancelled/i);
  expect(await a.calendar.listEvents(new Date('2026-09-01'),new Date('2026-10-01'))).toHaveLength(0);
 } finally {a.db.appDb.close();a.simulator.db.appDb.close();}
});
