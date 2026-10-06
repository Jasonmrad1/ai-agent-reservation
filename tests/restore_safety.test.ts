import {it,expect} from 'vitest';import {SupabaseSync} from '../src/db/supabase.js';import {createDatabaseContext} from '../src/db/index.js';
import {restoreReplica} from '../src/db/restore.js';
const replica=(data:Record<string,any[]>)=>({from:(table:string)=>({select:()=>({order:()=>({range:async(start:number,end:number)=>({data:(data[table] || []).slice(start,end+1),error:null})})})})});
it('restores all pages and rolls back an invalid relationship',async()=>{
 const customers=Array.from({length:501},(_,i)=>({id:'c'+i,phone:'+9617'+String(i).padStart(8,'0'),name:'Test',opted_out:0,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'}));
 const d=createDatabaseContext(':memory:',{syncEnabled:false});await restoreReplica(d,replica({customers,settings:[{key:'timezone_storage_version',value:'utc-v1'}]}));expect(d.appDb.db.prepare('SELECT count(*) AS n FROM customers').get()?.n).toBe(501);d.appDb.close();
 const broken=createDatabaseContext(':memory:',{syncEnabled:false});await expect(restoreReplica(broken,replica({customers:[customers[0]],conversations:[{id:'v',customer_id:'missing',channel:'whatsapp',status:'active',created_at:'2026-09-01',updated_at:'2026-09-01'}]}))).rejects.toThrow();expect(broken.appDb.db.prepare('SELECT count(*) AS n FROM customers').get()?.n).toBe(0);expect(broken.settings.get('timezone_storage_version')).toBe('utc-v1');broken.appDb.close();
});
it('rejects an implicit cloud restore instead of mutating local data',async()=>{const db=createDatabaseContext(':memory:');const c=db.customers.findOrCreate('+96171000111');await expect(SupabaseSync.hydrateFromSupabase(db)).rejects.toThrow(/explicit|restore/i);expect(db.customers.findById(c.id)).not.toBeNull();});
