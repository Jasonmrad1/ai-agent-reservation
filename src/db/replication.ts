import { DatabaseSync } from 'node:sqlite';
import { DatabaseContext } from './index.js';

export const REPLICA_TABLES=['customers','conversations','messages','appointments','availability_rules','availability_overrides','settings','invoices','admin_alerts','pending_booking_workflows','scheduling_reservations','calendar_operations','appointment_operations','inbound_jobs','outbound_jobs','reminder_claims','message_status_events'] as const;
const primaryKey=(table:string)=> table==='settings' ? 'key' : table==='appointment_operations' ? 'operation_key' : table==='reminder_claims' ? 'claim_key' : ['inbound_jobs','message_status_events'].includes(table) ? 'message_sid' : 'id';
export function installReplicationTriggers(sql:DatabaseSync,enabled:boolean):void {
  sql.exec('CREATE TABLE IF NOT EXISTS replication_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT NOT NULL,record_key TEXT NOT NULL,operation TEXT NOT NULL,payload TEXT,last_error TEXT,attempts INTEGER NOT NULL DEFAULT 0)');
  for(const table of REPLICA_TABLES) {
    for(const action of ['INSERT','UPDATE','DELETE']) sql.exec(`DROP TRIGGER IF EXISTS replica_${table}_${action}`);
    if(!enabled) continue;
    const cols=sql.prepare(`PRAGMA table_info(${table})`).all() as any[];
    const payload=`json_object(${cols.map(c=>`'${c.name}',NEW.${c.name}`).join(',')})`;
    for(const action of ['INSERT','UPDATE','DELETE']) {
      const row=action==='DELETE' ? 'OLD' : 'NEW';
      const condition=table==='settings' ? `WHEN ${row}.key NOT LIKE '%token%' AND ${row}.key NOT LIKE '%secret%' AND ${row}.key NOT LIKE '%password%'` : '';
      sql.exec(`CREATE TRIGGER replica_${table}_${action} AFTER ${action} ON ${table} ${condition} BEGIN INSERT INTO replication_jobs(table_name,record_key,operation,payload) VALUES ('${table}',${row}.${primaryKey(table)},'${action==='DELETE' ? 'delete' : 'upsert'}',${action==='DELETE' ? 'NULL' : payload}); END`);
    }
  }
}

export class ReplicaWorker {
  private running=false;
  constructor(private db:DatabaseContext,private client:any) {}
  async drain():Promise<void> {
    if(!this.client || this.running) return;this.running=true;
    try {
      for(const job of this.db.appDb.db.prepare('SELECT * FROM replication_jobs ORDER BY id LIMIT 100').all() as any[]) {
        try {
          const table=this.client.from(job.table_name);
          const result=job.operation==='delete' ? await table.delete().eq(primaryKey(job.table_name),job.record_key) : await table.upsert(JSON.parse(job.payload),{onConflict:primaryKey(job.table_name)});
          if(result.error) throw new Error(result.error.message);
          this.db.appDb.db.prepare('DELETE FROM replication_jobs WHERE id=?').run(job.id);
        } catch(error:any) {
          this.db.appDb.db.prepare('UPDATE replication_jobs SET last_error=?,attempts=attempts+1 WHERE id=?').run(String(error.message || error).slice(0,500),job.id);
          if(!job.last_error) this.db.alerts.create({type:'system_error',title:'Cloud replica is behind SQLite',details:`Replication job ${job.id} failed; local clinic data is intact. Check replica schema and connection.`});
          break; // Preserve dependency and update order, including deletions.
        }
      }
    } finally {this.running=false;}
  }
}
