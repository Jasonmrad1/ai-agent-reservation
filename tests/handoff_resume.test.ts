import {it,expect} from 'vitest';import request from 'supertest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it.each(['YES','help','book an appointment'])('keeps human takeover active for %s until explicit resume',async text=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const c=a.db.customers.findOrCreate('+96171000111');const v=a.db.conversations.getOrCreateActive(c.id);a.db.conversations.updateStatus(v.id,'doctor_active');
 const r=await request(a.app).post('/api/webhook/whatsapp').send({From:c.phone,Body:text,MessageSid:'SM'+text});expect(r.status).toBe(200);expect(a.db.conversations.findActiveByCustomerId(c.id)?.status).toBe('doctor_active');expect((a.gateway as any).sentMessages).toHaveLength(0);
});
