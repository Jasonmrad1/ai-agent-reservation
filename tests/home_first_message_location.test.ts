import {it,expect} from 'vitest';import request from 'supertest';
import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import {clinicIso} from './clinic-time.js';
it('saves a first-message home request so a later location pin completes it',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const From='+96171010991';
 try {
  await request(a.app).post('/api/webhook/whatsapp').send({From,Body:'Book a home visit September 14 at 11am',MessageSid:'SM_FIRST_HOME'});
  const c=a.db.customers.findByPhone(From)!;
  expect(a.db.workflows.findActiveByCustomerId(c.id)?.state).toBe('awaiting_address');
  expect(a.db.workflows.findActiveByCustomerId(c.id)?.time).toBe('11:00');
  await request(a.app).post('/api/webhook/whatsapp').send({From,Body:'',Latitude:'33.8938',Longitude:'35.5018',Label:'Beirut building 20',MessageSid:'SM_FIRST_HOME_PIN'});
  const visits=a.db.appointments.findUpcomingByCustomerId(c.id);expect(visits).toHaveLength(1);
  expect(visits[0].start_time).toBe(clinicIso('2026-09-14T11:00:00Z'));expect(visits[0].address).toContain('Beirut building 20');
 }finally{a.db.appDb.close();a.simulator.db.appDb.close();}
});
