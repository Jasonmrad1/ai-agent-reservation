import {it,expect} from 'vitest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it.each(['I have severe chest pain and shortness of breath','عندي ألم في الصدر وضيق في التنفس','3andi waja3 bi sadre w dii2et nafas'])('interrupts an address workflow for urgent symptoms: %s',async text=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const c=a.db.customers.findOrCreate('+96171000111');const v=a.db.conversations.getOrCreateActive(c.id);a.db.workflows.create({customer_id:c.id,conversation_id:v.id,state:'awaiting_address',visit_type:'home_visit',date:'2026-09-14',time:'10:00'});
 const reply=await a.agent.processMessage({customer:c,conversation:v,incomingText:text,db:a.db});
 expect(reply).toContain('140');expect(a.db.appointments.findUpcomingByCustomerId(c.id)).toHaveLength(0);expect(a.db.conversations.findActiveByCustomerId(c.id)?.status).toBe('escalated');
});
import request from 'supertest';
it('prioritizes emergency instructions over message length guardrails',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});await request(a.app).post('/api/webhook/whatsapp').send({From:'+96171000126',Body:'severe chest pain '+ 'details '.repeat(100),MessageSid:'SM_LONG_URGENT'});
 expect((a.gateway as any).sentMessages.find((m:any)=>m.to.includes('96171000126')).body).toContain('140');
});
