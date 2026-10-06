import {DatabaseContext} from './index.js';
export interface ReviewedTime {id:string;start_time:string;end_time:string;google_event_id:string|null;}
/** Times must come from a human-reviewed export and matching real calendar events. */
export function applyReviewedTimes(db:DatabaseContext,rows:ReviewedTime[]):void {
 const sql=db.appDb.db;const current=sql.prepare('SELECT id,status FROM appointments').all() as any[];
 if(rows.length!==current.length || new Set(rows.map(r=>r.id)).size!==current.length || current.some(a=>!rows.some(r=>r.id===a.id)))throw new Error('Review must include every appointment exactly once');
 if(sql.prepare('SELECT id FROM calendar_operations LIMIT 1').get() || sql.prepare('SELECT id FROM scheduling_reservations LIMIT 1').get())throw new Error('Reconcile pending calendar operations before timestamp migration');
 for(const row of rows){
  const start=new Date(row.start_time),end=new Date(row.end_time);
  if(!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.toISOString()!==row.start_time || end.toISOString()!==row.end_time || end<=start)throw new Error('Reviewed timestamps must be canonical UTC ISO strings with a positive duration');
  if(['booked','confirmed','rescheduled'].includes(current.find(a=>a.id===row.id).status) && (!row.google_event_id || /^(local_|cal_)/.test(row.google_event_id)))throw new Error('Active appointment must match a real calendar event');
 }
 sql.exec('BEGIN IMMEDIATE');try{
  for(const row of rows)sql.prepare('UPDATE appointments SET start_time=?,end_time=?,google_event_id=?,reminder_24h_sent=0,reminder_1h_sent=0 WHERE id=?').run(row.start_time,row.end_time,row.google_event_id,row.id);
  db.settings.set('timezone_storage_version','utc-v1');sql.exec('COMMIT');
 }catch(error){sql.exec('ROLLBACK');throw error;}
}
