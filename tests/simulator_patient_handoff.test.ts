import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';

it.each(['doctor_active','escalated'] as const)('honors %s throughout a simulated patient conversation',async status=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',adminSessionSecret:'test-secret'}});
 const db=a.simulator.db;const c=db.customers.findOrCreate('+96171000893','Patient');const conv=db.conversations.getOrCreateActive(c.id);
 const appt=db.appointments.create({customer_id:c.id,visit_type:'in_office',service:'Consultation',price:120,start_time:'2026-09-14T07:00:00.000Z',end_time:'2026-09-14T08:00:00.000Z'});
 db.conversations.updateStatus(conv.id,status);
 const send=(text:string)=>request(a.app).post('/api/simulator/message').set('Authorization','Bearer test-secret').send({phone:c.phone,text});
 try {
  for(const text of ['hello','CANCEL','write a python function']){
   const r=await send(text);expect(r.status).toBe(200);expect(r.body.reply).toBe('');
   expect(db.appointments.findById(appt.id)?.status).toBe('booked');
   expect(db.conversations.findActiveByCustomerId(c.id)?.status).toBe(status);
  }
  expect(db.messages.getRecentMessages(conv.id).filter(m=>m.direction==='outbound')).toHaveLength(0);
  expect((await send('chest pain and cannot breathe')).body.reply).toContain('140');
  expect(db.conversations.findActiveByCustomerId(c.id)?.status).toBe('escalated');
  expect((await send('/resume bot')).body.reply).toBe('');
  expect(db.conversations.findActiveByCustomerId(c.id)?.status).toBe('active');
  expect((await send('hello')).body.reply.length).toBeGreaterThan(0);
 } finally {a.db.appDb.close();db.appDb.close();}
});
