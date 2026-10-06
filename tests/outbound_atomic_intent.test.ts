import {it,expect,vi} from 'vitest';
import {createDatabaseContext} from '../src/db/index.js';
import {MockWhatsAppGateway} from '../src/twilio/client.js';
import {DurableWhatsAppGateway} from '../src/twilio/durable.js';

it('rolls back the send intent when its audit message cannot be stored',async()=>{
 const db=createDatabaseContext(':memory:');
 const raw=new MockWhatsAppGateway();const gateway=new DurableWhatsAppGateway(db,raw);
 try {
  const fault=vi.spyOn(db.messages,'create').mockImplementationOnce(()=>{throw new Error('Disk write failure');});
  await expect(gateway.sendMessage('+96171000882','hello')).rejects.toThrow('Disk write failure');
  fault.mockRestore();
  expect(db.appDb.db.prepare('SELECT * FROM outbound_jobs').all()).toHaveLength(0);
  await gateway.drain(true);
  expect(raw.sentMessages).toHaveLength(0);
  await gateway.sendMessage('+96171000882','hello');
  expect(raw.sentMessages).toHaveLength(1);
 } finally {db.appDb.db.close();}
});
