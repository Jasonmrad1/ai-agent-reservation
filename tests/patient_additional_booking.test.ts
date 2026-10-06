import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';
import {MockGeminiClient} from '../src/gemini/index.js';
import {clinicIso} from './clinic-time.js';

it.each(['clinic','home'])('preserves another-appointment intent across the %s booking steps',async type=>{
 const client=new MockGeminiClient();const a=createApp({config:{...config,databaseUrl:':memory:'},geminiClient:client});
 try {
  const c=a.db.customers.findOrCreate('+96171000891','Patient');
  const old=await a.scheduler.bookAppointment({customerId:c.id,customerPhone:c.phone,service:'Consultation',visitType:'in_office',startTime:clinicIso('2026-09-14T10:00:00Z')});
  const send=(Body:string,MessageSid:string)=>request(a.app).post('/api/webhook/whatsapp').send({From:c.phone,Body,MessageSid});
  client.mockToolCall={name:'check_availability',args:{date:'2026-09-15',visit_type:'in_office'}};
  expect((await send('Can I book another appointment September 15 at 11am?','SM_NEW_QUESTION')).status).toBe(200);
  expect(a.db.workflows.findActiveByCustomerId(c.id)?.state).toBe('awaiting_visit_type');
  client.mockToolCall=null;
  expect((await send(type==='clinic'?'in clinic':'home visit please','SM_NEW_TYPE')).status).toBe(200);
  if(type==='home'){
   expect(a.db.workflows.findActiveByCustomerId(c.id)?.state).toBe('awaiting_address');
   const location=await request(a.app).post('/api/webhook/whatsapp').send({From:c.phone,Body:'',Latitude:'33.8938',Longitude:'35.5018',Label:'Beirut, building 10',MessageSid:'SM_NEW_LOCATION'});
   expect(location.status).toBe(200);
  }
  expect(a.db.appointments.findById(old.id)?.start_time).toBe(old.start_time);
  expect(a.db.appointments.findById(old.id)?.status).toBe('booked');
  const visits=a.db.appointments.findUpcomingByCustomerId(c.id);
  expect(visits).toHaveLength(2);
  expect(visits.some(v=>v.start_time===clinicIso('2026-09-15T11:00:00Z'))).toBe(true);
  const added=visits.find(v=>v.id!==old.id)!;
  expect(added.visit_type).toBe(type==='clinic'?'in_office':'home_visit');
  if(type==='home')expect(added.address).toContain('Beirut, building 10');
  expect((a.gateway as any).sentMessages.at(-1).body).toMatch(/confirmed/i);
 } finally {a.db.appDb.close();}
});
