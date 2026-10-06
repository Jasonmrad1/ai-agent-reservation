import {it,expect} from 'vitest';import fs from 'node:fs';import {createDatabaseContext} from '../src/db/index.js';import {REPLICA_TABLES} from '../src/db/replication.js';
it('defines every replica table and column and restricts public cloud access',()=>{
 const sql=fs.readFileSync('deployment/replica-schema.sql','utf8');const d=createDatabaseContext(':memory:');
 for(const table of REPLICA_TABLES){expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);for(const c of d.appDb.db.prepare(`PRAGMA table_info(${table})`).all() as any[])expect(sql).toContain(`"${c.name}"`);}
 d.appDb.close();expect(sql).toContain('REVOKE ALL');
});
