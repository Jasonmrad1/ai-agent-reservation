import {it,expect} from 'vitest';import request from 'supertest';
import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import {clinicIso} from './clinic-time.js';
let count=0;
it.each(['clinic','home'])('runs a complete %s booking and cancellation through the simulator API',async type=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',adminSessionSecret:'test-secret'}});const phone=`+9617104${String(count++).padStart(4,'0')}`;
 const send=async(text:string)=>{const r=await request(a.app).post('/api/simulator/message').set('Authorization','Bearer test-secret').send({phone,name:'Patient',text});expect(r.status).toBe(200);return r.body;};
 try {
  const asked=await send(`Book ${type==='home'?'a home visit':'in clinic'} September 14 at 11am`);
  if(type==='home'){
   expect(asked.appointments).toHaveLength(0);expect(asked.reply).toMatch(/address/i);
   expect((await send('My address is Beirut, Hamra, building 20')).reply).toMatch(/confirmed/i);
  }else expect(asked.reply).toMatch(/confirmed/i);
  const db=a.simulator.db;const c=db.customers.findByPhone(phone)!;const original=db.appointments.findUpcomingByCustomerId(c.id)[0];
  expect(original.start_time).toBe(clinicIso('2026-09-14T11:00:00Z'));expect(original.visit_type).toBe(type==='home'?'home_visit':'in_office');
  expect((await send('YES')).reply).toMatch(/confirmed/i);expect(db.appointments.findById(original.id)?.status).toBe('confirmed');
  expect((await send('Move my appointment to September 15 at 2pm')).reply).toMatch(/rescheduled/i);
  expect(db.appointments.findById(original.id)?.start_time).toBe(clinicIso('2026-09-15T14:00:00Z'));
  expect((await send('cancel my appointment')).reply).toMatch(/cancelled/i);expect(db.appointments.findById(original.id)?.status).toBe('cancelled');
  const history=await request(a.app).get('/api/simulator/history').set('Authorization','Bearer test-secret').query({phone});
  expect(history.body.appointments).toHaveLength(0);expect(history.body.messages.filter((m:any)=>m.direction==='inbound').length).toBe(type==='home'?5:4);
  expect(a.db.appDb.db.prepare('SELECT * FROM appointments').all()).toHaveLength(0);expect((a.gateway as any).sentMessages).toHaveLength(0);
 }finally{a.db.appDb.close();a.simulator.db.appDb.close();}
});
