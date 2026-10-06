import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';

it('persists STOP, suppresses replies while opted out, and resumes with START in the simulator',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',adminSessionSecret:'test-secret'}});
 const phone='+96171000892';
 const send=(text:string)=>request(a.app).post('/api/simulator/message').set('Authorization','Bearer test-secret').send({phone,name:'Patient',text});
 const history=()=>request(a.app).get('/api/simulator/history').set('Authorization','Bearer test-secret').query({phone});
 try {
  const stopped=await send('STOP');expect(stopped.status).toBe(200);
  expect(stopped.body.reply).toMatch(/unsubscribed|opted out/i);
  expect((await history()).body.customer.opted_out).toBe(true);
  const ignored=await send('Book me an appointment');expect(ignored.status).toBe(200);expect(ignored.body.reply).toBe('');
  expect(ignored.body.appointments).toHaveLength(0);
  const resumed=await send('START');expect(resumed.status).toBe(200);expect(resumed.body.reply).toMatch(/resumed|subscribed/i);
  expect((await history()).body.customer.opted_out).toBe(false);
  expect((await send('hello')).body.reply.length).toBeGreaterThan(0);
  expect((a.gateway as any).sentMessages).toHaveLength(0);
 } finally {a.db.appDb.close();a.simulator.db.appDb.close();}
});
