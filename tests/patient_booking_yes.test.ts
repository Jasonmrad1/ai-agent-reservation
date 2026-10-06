import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';
import {MockGeminiClient} from '../src/gemini/index.js';
import {clinicIso} from './clinic-time.js';

it('treats YES as the answer to a new booking question instead of confirming an older visit',async()=>{
 const client=new MockGeminiClient();const a=createApp({config:{...config,databaseUrl:':memory:'},geminiClient:client});
 try {
  const c=a.db.customers.findOrCreate('+96171000891','Patient');
  const old=await a.scheduler.bookAppointment({customerId:c.id,customerPhone:c.phone,service:'Consultation',visitType:'in_office',startTime:clinicIso('2026-09-14T10:00:00Z')});
  const send=(Body:string,MessageSid:string)=>request(a.app).post('/api/webhook/whatsapp').send({From:c.phone,Body,MessageSid});
  client.mockToolCall={name:'check_availability',args:{date:'2026-09-15',visit_type:'in_office'}};
  expect((await send('Can I book another appointment September 15 at 11am?','SM_NEW_QUESTION')).status).toBe(200);
  expect(a.db.workflows.findActiveByCustomerId(c.id)?.state).toBe('awaiting_visit_type');
  client.mockToolCall=null;
  expect((await send('YES','SM_NEW_YES')).status).toBe(200);
  expect(a.db.appointments.findById(old.id)?.status).toBe('booked');
  const visits=a.db.appointments.findUpcomingByCustomerId(c.id);
  expect(visits).toHaveLength(1);
  expect(visits[0].start_time).toBe(old.start_time);
  // YES does not choose between clinic and home: keep collecting the visit type.
  expect(a.db.workflows.findActiveByCustomerId(c.id)?.state).toBe('awaiting_visit_type');
  expect((a.gateway as any).sentMessages.at(-1).body).not.toContain('Your appointment has been confirmed');
 } finally {a.db.appDb.close();}
});
