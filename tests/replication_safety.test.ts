import {it,expect} from 'vitest';import {vi} from 'vitest';import {createDatabaseContext} from '../src/db/index.js';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import {SupabaseSync} from '../src/db/supabase.js';
import {ReplicaWorker} from '../src/db/replication.js';
it('seeds existing data and billing delivery claims into a new replica once',()=>{
 const d=createDatabaseContext(':memory:');d.appDb.db.prepare('INSERT INTO billing_notifications VALUES (?,?)').run('receipt:1','2026-09-01');
 new ReplicaWorker(d,{},'replica-one');const count=()=>d.appDb.db.prepare('SELECT * FROM replication_jobs').all() as any[];
 expect(count().some(j=>j.table_name==='availability_rules')).toBe(true);
 expect(count().some(j=>j.table_name==='billing_notifications')).toBe(true);
 const before=count().length;new ReplicaWorker(d,{},'replica-one');expect(count()).toHaveLength(before);
});
it('does not hydrate over authoritative SQLite during application startup',()=>{const hydrate=vi.spyOn(SupabaseSync,'hydrateFromSupabase').mockResolvedValue();const d=createDatabaseContext(':memory:');const c=d.customers.findOrCreate('+96171000111');createApp({db:d,config:{...config,databaseUrl:':memory:'}});expect(hydrate).not.toHaveBeenCalled();expect(d.customers.findById(c.id)).not.toBeNull();hydrate.mockRestore();});
it('durably records local updates and setting deletions for ordered replication',()=>{const d=createDatabaseContext(':memory:');d.customers.findOrCreate('+96171000111');d.settings.set('example','value');d.settings.delete('example');const jobs=d.appDb.db.prepare('SELECT * FROM replication_jobs ORDER BY id').all() as any[];expect(jobs.some(j=>j.table_name==='customers')).toBe(true);expect(jobs.filter(j=>j.table_name==='settings' && j.record_key==='example').map(j=>j.operation)).toEqual(['upsert','delete']);});
