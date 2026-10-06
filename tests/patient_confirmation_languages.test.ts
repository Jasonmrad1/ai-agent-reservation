import {it,expect} from 'vitest';import request from 'supertest';
import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
let index=0;
it.each(['YES','CONFIRM','OUI','TAMAM','نعم','أكيد','تمام','YES!','Oui.','نعم!'])('confirms the saved visit for "%s" without adding a booking',async text=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const From=`+9617103${String(index++).padStart(4,'0')}`;
 try {
  await request(a.app).post('/api/webhook/whatsapp').send({From,Body:'Book in clinic September 14 at 11am',MessageSid:'SM_LANG_BOOK'});
  const c=a.db.customers.findByPhone(From)!;const original=a.db.appointments.findUpcomingByCustomerId(c.id)[0];
  await request(a.app).post('/api/webhook/whatsapp').send({From,Body:text,MessageSid:'SM_LANG_CONFIRM'});
  const visits=a.db.appointments.findUpcomingByCustomerId(c.id);expect(visits).toHaveLength(1);expect(visits[0].id).toBe(original.id);
  expect(visits[0].status).toBe('confirmed');expect(visits[0].start_time).toBe(original.start_time);
 }finally{a.db.appDb.close();a.simulator.db.appDb.close();}
});

it('asks which visit an Arabic confirmation refers to and confirms only the selected one',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const From='+96171030999';let turn=0;
 const send=(Body:string)=>request(a.app).post('/api/webhook/whatsapp').send({From,Body,MessageSid:`SM_ARABIC_CHOICE_${turn++}`});
 try {
  await send('Book in clinic September 14 at 11am');await send('Book another appointment in clinic September 15 at 2pm');
  const c=a.db.customers.findByPhone(From)!;const original=a.db.appointments.findUpcomingByCustomerId(c.id);
  expect(original).toHaveLength(2);await send('نعم');
  expect((a.gateway as any).sentMessages.at(-1).body).toMatch(/which appointment/i);
  expect(a.db.appointments.findUpcomingByCustomerId(c.id).every(v=>v.status==='booked')).toBe(true);
  await send('2');expect(a.db.appointments.findById(original[0].id)?.status).toBe('booked');expect(a.db.appointments.findById(original[1].id)?.status).toBe('confirmed');
 }finally{a.db.appDb.close();a.simulator.db.appDb.close();}
});
