import {it,expect} from 'vitest';import request from 'supertest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import {MockWhatsAppGateway} from '../src/twilio/client.js';
it('keeps a failed outbound reply durable and recovers without running the agent twice',async()=>{
 const raw=new MockWhatsAppGateway();raw.shouldFail=true;const a=createApp({config:{...config,databaseUrl:':memory:'},gateway:raw});
 const payload={From:'+96171000111',Body:'hello',MessageSid:'SM_DURABLE'};await request(a.app).post('/api/webhook/whatsapp').send(payload);
 raw.shouldFail=false;await request(a.app).post('/api/webhook/whatsapp').send(payload);
 await (a as any).outbox.drain(true);expect(raw.sentMessages).toHaveLength(1);
 expect(a.db.messages.getRecentMessages(a.db.conversations.findActiveByCustomerId(a.db.customers.findByPhone(payload.From)!.id)!.id).filter(m=>m.direction==='inbound')).toHaveLength(1);
});
