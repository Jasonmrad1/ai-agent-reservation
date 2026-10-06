import {it,expect} from 'vitest';
import {createDatabaseContext} from '../src/db/index.js';
import {MockWhatsAppGateway} from '../src/twilio/client.js';
import {DurableWhatsAppGateway} from '../src/twilio/durable.js';

it.each(['pending','review','sending'])('does not report a duplicate %s job as provider acceptance',async status=>{
 const db=createDatabaseContext(':memory:');const raw=new MockWhatsAppGateway();const g=new DurableWhatsAppGateway(db,raw);
 try {
  raw.shouldFail=true;
  await expect(g.sendMessage('+96171000883','Reminder',undefined,{idempotencyKey:'same-reminder'})).rejects.toThrow();
  db.appDb.db.prepare('UPDATE outbound_jobs SET status=?').run(status);
  raw.shouldFail=false;
  await expect(g.sendMessage('+96171000883','Reminder',undefined,{idempotencyKey:'same-reminder'})).rejects.toThrow(/not accepted/i);
  expect(raw.sentMessages).toHaveLength(0);
  expect(db.appDb.db.prepare('SELECT * FROM outbound_jobs').all()).toHaveLength(1);
 } finally {db.appDb.close();}
});
it('returns the original accepted outcome without sending twice',async()=>{
 const db=createDatabaseContext(':memory:');const raw=new MockWhatsAppGateway();const g=new DurableWhatsAppGateway(db,raw);
 try {
  const first=await g.sendMessage('+96171000884','Reminder',undefined,{idempotencyKey:'accepted-reminder'});
  const second=await g.sendMessage('+96171000884','Reminder',undefined,{idempotencyKey:'accepted-reminder'});
  expect(second.messageSid).toBe(first.messageSid);expect(raw.sentMessages).toHaveLength(1);
 } finally {db.appDb.close();}
});
