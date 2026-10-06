import fs from 'node:fs';import {createDatabaseContext} from '../src/db/index.js';import {REPLICA_TABLES} from '../src/db/replication.js';
const d=createDatabaseContext(':memory:',{syncEnabled:false});
let sql='-- Generated from SQLite. Apply only to a new empty Supabase replica.\n-- SQLite remains authoritative; cloud restore verifies relationships.\nBEGIN;\n';
for(const table of REPLICA_TABLES){
 const columns=d.appDb.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
 const definitions=columns.map(c=>`  "${c.name}" ${c.type==='INTEGER' ? 'bigint' : c.type==='REAL' ? 'double precision' : 'text'}${c.pk ? ' PRIMARY KEY' : c.notnull ? ' NOT NULL' : ''}${c.dflt_value!==null ? ' DEFAULT '+c.dflt_value : ''}`);
 sql+=`CREATE TABLE IF NOT EXISTS public.${table} (\n${definitions.join(',\n')}\n);\nALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;\nREVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated;\nGRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO service_role;\n\n`;
}
sql+='COMMIT;\n';fs.mkdirSync('deployment',{recursive:true});fs.writeFileSync('deployment/replica-schema.sql',sql);d.appDb.close();
