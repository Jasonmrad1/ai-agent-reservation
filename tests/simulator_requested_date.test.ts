import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';

it.each(['September 14','October 12'])('checks the requested %s date in the offline simulator',async date=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',adminSessionSecret:'test-secret'}});
 try {
  const r=await request(a.app).post('/api/simulator/message').set('Authorization','Bearer test-secret').send({phone:'+96171000894',text:`What slots are available in clinic on ${date}?`});
  const expected=date==='September 14'?'2026-09-14':'2026-10-12';
  expect(r.status).toBe(200);expect(r.body.reply).toContain(expected);
  const customer=a.simulator.db.customers.findByPhone('+96171000894')!;
  expect(a.simulator.db.workflows.findActiveByCustomerId(customer.id)?.date).toBe(expected);
  expect(r.body.appointments).toHaveLength(0);
 } finally {a.db.appDb.close();a.simulator.db.appDb.close();}
});
