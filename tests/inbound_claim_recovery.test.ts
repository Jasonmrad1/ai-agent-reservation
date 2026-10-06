import {it,expect,vi} from 'vitest';
import {createDatabaseContext} from '../src/db/index.js';
import {MockWhatsAppGateway} from '../src/twilio/client.js';
import {createWebhookRouter} from '../src/twilio/webhook.js';

it('releases the patient lock after an inbound database claim fails',async()=>{
 const db=createDatabaseContext(':memory:');const raw=new MockWhatsAppGateway();const processMessage=vi.fn(async()=> 'hello');
 const router=createWebhookRouter({db,gateway:raw,processMessage,skipSignatureVerification:true,asyncProcessing:true});
 const res:any={type(){return this;},status(){return this;},send(){return this;}};
 const sql=db.appDb.db;const prepare=sql.prepare.bind(sql);
 let fault:ReturnType<typeof vi.spyOn>|undefined;
 try {
  await router.handleInboundMessage({body:{From:'+96171000886',Body:'hello',MessageSid:'SM_CLAIM_RECOVERY'}} as any,res);
  fault=vi.spyOn(sql,'prepare').mockImplementation((query:string)=>{
   if(query.startsWith("UPDATE inbound_jobs SET status='processing'"))throw new Error('Temporary database failure');
   return prepare(query);
  });
  await expect(router.drain()).rejects.toThrow('Temporary database failure');fault.mockRestore();
  await router.drain();
  expect(processMessage).toHaveBeenCalledTimes(1);expect(raw.sentMessages).toHaveLength(1);
  expect(sql.prepare('SELECT status FROM inbound_jobs').get()?.status).toBe('done');
 } finally {fault?.mockRestore();db.appDb.close();}
});
