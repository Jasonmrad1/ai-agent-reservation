import { it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
it('asks which appointment to cancel and acts only after selection', async () => {
  const a=createApp({config:{...config,databaseUrl:':memory:'}}); const c=a.db.customers.findOrCreate('+96171000111'); const v=a.db.conversations.getOrCreateActive(c.id);
  const add=(date:string)=>a.db.appointments.create({customer_id:c.id,visit_type:'in_office',service:'Consultation',price:120,start_time:date,end_time:new Date(new Date(date).getTime()+3600000).toISOString()});
  const first=add('2026-09-14T10:00:00Z'); const second=add('2026-09-15T10:00:00Z');
  const reply=await a.agent.processMessage({customer:c,conversation:v,incomingText:'cancel my appointment',db:a.db});
  expect(reply).toMatch(/which appointment/i);
  expect(a.db.appointments.findById(first.id)?.status).toBe('booked');
  await a.agent.processMessage({customer:c,conversation:v,incomingText:'2',db:a.db});
  expect(a.db.appointments.findById(first.id)?.status).toBe('booked');
  expect(a.db.appointments.findById(second.id)?.status).toBe('cancelled');
});
