import {it,expect} from 'vitest';import request from 'supertest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import {MockWhatsAppGateway} from '../src/twilio/client.js';
import {DurableWhatsAppGateway} from '../src/twilio/durable.js';
it('atomically claims an outbound job across two workers',async()=>{
 const raw=new MockWhatsAppGateway();const a=createApp({config:{...config,databaseUrl:':memory:'},gateway:raw});
 raw.shouldFail=true;await expect(a.outbox.sendMessage('+96171000999','first')).rejects.toThrow();await expect(a.outbox.sendMessage('+96171000999','second')).rejects.toThrow();raw.shouldFail=false;
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);const original=raw.sendMessage.bind(raw);
 raw.sendMessage=async(...args)=>{if(args[1]==='first')await gate;return original(...args);};
 const second=new DurableWhatsAppGateway(a.db,raw);
 const firstDrain=a.outbox.drain(true);await second.drain(true);release();await firstDrain;
 expect(raw.sentMessages).toHaveLength(2);
});
it('keeps a failed outbound reply durable and recovers without running the agent twice',async()=>{
 const raw=new MockWhatsAppGateway();raw.shouldFail=true;const a=createApp({config:{...config,databaseUrl:':memory:'},gateway:raw});
 const payload={From:'+96171000111',Body:'hello',MessageSid:'SM_DURABLE'};await request(a.app).post('/api/webhook/whatsapp').send(payload);
 raw.shouldFail=false;await request(a.app).post('/api/webhook/whatsapp').send(payload);
 await (a as any).outbox.drain(true);expect(raw.sentMessages).toHaveLength(1);
 expect(a.db.messages.getRecentMessages(a.db.conversations.findActiveByCustomerId(a.db.customers.findByPhone(payload.From)!.id)!.id).filter(m=>m.direction==='inbound')).toHaveLength(1);
});
