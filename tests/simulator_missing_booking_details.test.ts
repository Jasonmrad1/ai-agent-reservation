import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';

it.each(['book an appointment','book a home visit'])('asks for missing details instead of inventing a booking for "%s"',async text=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',adminSessionSecret:'test-secret'}});
 try {
  const r=await request(a.app).post('/api/simulator/message').set('Authorization','Bearer test-secret').send({phone:'+96171000896',text});
  expect(r.status).toBe(200);expect(r.body.appointments).toHaveLength(0);
  expect(r.body.reply).toMatch(/day.*time|date.*time/i);
  expect(r.body.reply).not.toMatch(/confirmed|789 Pine/i);
  expect(a.simulator.db.appDb.db.prepare('SELECT * FROM appointments').all()).toHaveLength(0);
 } finally {a.db.appDb.close();a.simulator.db.appDb.close();}
});
