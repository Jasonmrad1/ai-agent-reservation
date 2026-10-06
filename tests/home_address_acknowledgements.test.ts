import {it,expect} from 'vitest';import request from 'supertest';
import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it.each(['thank you','yes please','ok thanks','merci beaucoup'])('keeps collecting the home address after "%s"',async text=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const From='+96171010993';let n=0;
 const send=(Body:string)=>request(a.app).post('/api/webhook/whatsapp').send({From,Body,MessageSid:`SM_ACK_${text}_${n++}`});
 try {
  await send('Book a home visit September 14 at 11am');await send(text);
  const c=a.db.customers.findByPhone(From)!;expect(a.db.appointments.findUpcomingByCustomerId(c.id)).toHaveLength(0);
  expect(a.db.workflows.findActiveByCustomerId(c.id)?.state).toBe('awaiting_address');
  await send('My address is Beirut, Hamra, building 20, floor 2');
  expect(a.db.appointments.findUpcomingByCustomerId(c.id)[0].address).toBe('Beirut, Hamra, building 20, floor 2');
 } finally {a.db.appDb.close();a.simulator.db.appDb.close();}
});
