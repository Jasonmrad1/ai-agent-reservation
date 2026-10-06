import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';
import {clinicIso} from './clinic-time.js';

it('shows simulator bookings, moves and cancellations in its isolated calendar',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',adminSessionSecret:'test-secret'}});
 const send=(text:string)=>request(a.app).post('/api/simulator/message').set('Authorization','Bearer test-secret').send({phone:'+96171091091',name:'Demo Patient',text});
 const calendar=()=>request(a.app).get('/api/simulator/admin/api/appointments').set('Authorization','Bearer test-secret');
 try {
  expect((await send('Book in clinic September 14 at 11am')).body.reply).toMatch(/confirmed/i);
  const booked=await calendar();expect(booked.status).toBe(200);expect(booked.body.appointments).toHaveLength(1);
  const id=booked.body.appointments[0].id;
  expect((await send('Move my appointment to September 15 at 2pm')).body.reply).toMatch(/rescheduled/i);
  const moved=await calendar();expect(moved.body.appointments).toHaveLength(1);expect(moved.body.appointments[0].id).toBe(id);expect(moved.body.appointments[0].start_time).toBe(clinicIso('2026-09-15T14:00:00Z'));
  expect((await send('cancel my appointment')).body.reply).toMatch(/cancelled/i);expect((await calendar()).body.appointments).toHaveLength(0);
  expect(a.db.appDb.db.prepare('SELECT * FROM appointments').all()).toHaveLength(0);expect((a.gateway as any).sentMessages).toHaveLength(0);
 }finally{a.db.appDb.close();a.simulator.db.appDb.close();}
});

it('applies simulator work hours to chat booking without changing clinic hours',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',adminSessionSecret:'test-secret'}});
 try {
  const rules=a.simulator.db.availability.getAllRules().map(r=>r.day_of_week===1?{...r,start_time:'12:00',end_time:'17:00',shifts:[{start:'12:00',end:'17:00'}]}:r);
  const saved=await request(a.app).post('/api/simulator/admin/api/availability/rules/batch').set('Authorization','Bearer test-secret').send({rules});expect(saved.status).toBe(200);
  expect(a.simulator.db.availability.getAllRules().find(r=>r.day_of_week===1)?.start_time).toBe('12:00');expect(a.db.availability.getAllRules().find(r=>r.day_of_week===1)?.start_time).toBe('09:00');
  const result=await request(a.app).post('/api/simulator/message').set('Authorization','Bearer test-secret').send({phone:'+96171091092',text:'Book in clinic September 14 at 11am'});expect(result.status).toBe(200);expect(result.body.appointments).toHaveLength(0);
 }finally{a.db.appDb.close();a.simulator.db.appDb.close();}
});

it('protects sandbox calendar and settings with authentication and session CSRF',async()=>{
 const a=createApp({config:{...config,nodeEnv:'development',databaseUrl:':memory:',adminSessionSecret:'test-secret'}});
 try {
  expect((await request(a.app).get('/api/simulator/admin/api/appointments')).status).toBe(401);
  const browser=request.agent(a.app);const login=await browser.post('/admin/login').send({secret:'test-secret'});expect(login.status).toBe(200);
  expect((await browser.post('/api/simulator/admin/api/settings').send({home_visit_buffer_minutes:45})).status).toBe(403);
  expect((await browser.post('/api/simulator/admin/api/settings').set('x-csrf-token',login.body.csrfToken).send({home_visit_buffer_minutes:45})).status).toBe(200);
  expect(a.simulator.db.settings.get('home_visit_buffer_minutes')).toBe('45');expect(a.db.settings.get('home_visit_buffer_minutes')).toBe('30');
  expect((await browser.get('/api/simulator/admin/auth/google')).status).toBe(404);
 }finally{a.db.appDb.close();a.simulator.db.appDb.close();}
});
