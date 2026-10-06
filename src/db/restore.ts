import { DatabaseContext } from './index.js';
import { REPLICA_TABLES } from './replication.js';

/** Explicit disaster recovery into a new empty database. Quiesce the source replica first. */
export async function restoreReplica(db:DatabaseContext,client:any):Promise<Record<string,number>> {
  if(!client) throw new Error('A configured replica is required');
  const sql=db.appDb.db;
  for(const table of REPLICA_TABLES) {
    if(['availability_rules','settings'].includes(table)) continue;
    if((sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count) throw new Error('Restore destination must be empty');
  }
  const snapshot:Record<string,any[]>={};
  // Download every page before mutating the destination. Missing tables/errors abort recovery.
  for(const table of REPLICA_TABLES) {
    snapshot[table]=[];
    const primary=(sql.prepare(`PRAGMA table_info(${table})`).all() as any[]).find(c=>c.pk)?.name;
    for(let offset=0;;offset+=500) {
      const result=await client.from(table).select('*').order(primary,{ascending:true}).range(offset,offset+499);
      if(result.error || !Array.isArray(result.data)) throw new Error(`Replica restore failed reading ${table}`);
      snapshot[table].push(...result.data);
      if(result.data.length<500) break;
    }
  }
  sql.exec('BEGIN IMMEDIATE');
  try {
    sql.exec('DELETE FROM availability_rules; DELETE FROM settings;');
    for(const table of REPLICA_TABLES) {
      const columns=(sql.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c=>c.name);
      for(const row of snapshot[table]) {
        if(table==='settings' && /token|secret|password|credential/i.test(row.key)) continue;
        const keys=columns.filter(k=>row[k]!==undefined);
        const values=keys.map(k=>typeof row[k]==='boolean' ? Number(row[k]) : row[k]!==null && typeof row[k]==='object' ? JSON.stringify(row[k]) : row[k]);
        sql.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...values);
      }
    }
    if(sql.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Replica contains broken relationships');
    sql.exec('COMMIT');
  } catch(error) {sql.exec('ROLLBACK');throw error;}
  return Object.fromEntries(Object.entries(snapshot).map(([table,rows])=>[table,rows.length]));
}
