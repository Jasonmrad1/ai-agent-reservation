import {it,expect} from 'vitest';
import {createDatabaseContext} from '../src/db/index.js';
import {restoreReplica} from '../src/db/restore.js';
import {installReplicationTriggers} from '../src/db/replication.js';

it('removes credential changes queued by older replication triggers',()=>{
 const db=createDatabaseContext(':memory:');
 try {
  db.appDb.db.prepare("INSERT INTO replication_jobs(table_name,record_key,operation,payload) VALUES ('settings','provider_credential','upsert','{}')").run();
  installReplicationTriggers(db.appDb.db,true);
  expect(db.appDb.db.prepare("SELECT * FROM replication_jobs WHERE record_key='provider_credential'").all()).toHaveLength(0);
 } finally {db.appDb.close();}
});

it('excludes credential settings from ongoing replica changes',()=>{
 const db=createDatabaseContext(':memory:');
 try {
  db.settings.set('provider_credential','private');
  db.settings.set('provider_credential','updated');
  db.settings.delete('provider_credential');
  expect(db.appDb.db.prepare("SELECT * FROM replication_jobs WHERE record_key='provider_credential'").all()).toHaveLength(0);
 } finally {db.appDb.close();}
});
it('does not restore credential settings from a cloud snapshot',async()=>{
 const db=createDatabaseContext(':memory:',{syncEnabled:false});
 const client={from:(table:string)=>({select:()=>({order:()=>({range:async()=>({data:table==='settings'?[{key:'provider_credential',value:'private'},{key:'timezone_storage_version',value:'utc-v1'}]:[],error:null})})})})};
 try {
  await restoreReplica(db,client);
  expect(db.appDb.db.prepare("SELECT * FROM settings WHERE key='provider_credential'").get()).toBeUndefined();
  expect(db.settings.get('timezone_storage_version')).toBe('utc-v1');
 } finally {db.appDb.close();}
});
