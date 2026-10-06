import {it,expect,vi} from 'vitest';
import {createDatabaseContext} from '../src/db/index.js';
import {MockWhatsAppGateway} from '../src/twilio/client.js';
import {DurableWhatsAppGateway} from '../src/twilio/durable.js';

it('releases the local send lock after a database claim fails',async()=>{
 const db=createDatabaseContext(':memory:');const raw=new MockWhatsAppGateway();const g=new DurableWhatsAppGateway(db,raw);
 const sql=db.appDb.db;const prepare=sql.prepare.bind(sql);let failed=false;
 const fault=vi.spyOn(sql,'prepare').mockImplementation((query:string)=>{
  if(!failed && query.startsWith("UPDATE outbound_jobs SET status='sending'")){failed=true;throw new Error('Temporary database failure');}
  return prepare(query);
 });
 try {
  await expect(g.sendMessage('+96171000885','hello')).rejects.toThrow('Temporary database failure');
  fault.mockRestore();
  await g.drain(true);
  expect(raw.sentMessages).toHaveLength(1);
  expect(sql.prepare('SELECT status FROM outbound_jobs').get()?.status).toBe('accepted');
 } finally {fault.mockRestore();db.appDb.close();}
});
