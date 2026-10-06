import {it,expect} from 'vitest';
import {createDatabaseContext} from '../src/db/index.js';
import {MockWhatsAppGateway} from '../src/twilio/client.js';
import {createWebhookRouter} from '../src/twilio/webhook.js';

it('serializes equivalent sender formats, including already queued messages',async()=>{
 const db=createDatabaseContext(':memory:');let release!:()=>void;let started!:()=>void;
 const gate=new Promise<void>(r=>release=r);const entered=new Promise<void>(r=>started=r);const order:string[]=[];
 const router=createWebhookRouter({db,gateway:new MockWhatsAppGateway(),skipSignatureVerification:true,asyncProcessing:true,processMessage:async({incomingText})=>{
  order.push(incomingText);if(incomingText==='first'){started();await gate;}return 'received';
 }});
 // Simulate jobs persisted by the old intake code, which retained raw sender formatting.
 for(const [index,sender] of ['+96171000887','whatsapp:+96171000887'].entries()){
  db.appDb.db.prepare('INSERT INTO inbound_jobs(message_sid,sender,payload,created_at) VALUES (?,?,?,?)').run(`SM_ORDER_${index}`,sender,JSON.stringify({From:sender,Body:index===0?'first':'second',MessageSid:`SM_ORDER_${index}`}),new Date().toISOString());
 }
 let first:Promise<void>|undefined;
 try {
  first=router.drain();await entered;
  await router.drain();
  expect(order).toEqual(['first']);
  release();await first;
  expect(order).toEqual(['first','second']);
 } finally {release();await first;db.appDb.close();}
});
