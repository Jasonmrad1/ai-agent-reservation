import {DatabaseContext} from './db/index.js';import {AppConfig} from './config/index.js';
export function readiness(db:DatabaseContext,cfg:AppConfig){
 const sql=db.appDb.db;const blockers:string[]=[];
 try{sql.prepare('SELECT 1').get();}catch{blockers.push('Database unavailable');}
 if(cfg.mode!=='simulator'){
  if(db.settings.get('timezone_storage_version')!=='utc-v1')blockers.push('Legacy appointment times require review');
  if(!db.settings.get('google_calendar_refresh_token'))blockers.push('Google Calendar is not connected');
  if(!cfg.twilioAccountSid || !cfg.twilioAuthToken || !cfg.geminiApiKey)blockers.push('Live provider configuration is incomplete');
  if(process.env.CLINIC_SETUP_REVIEWED!=='true')blockers.push('Clinic hours, services, pricing and phone deployment require approval');
  if(sql.prepare('SELECT appointment_id FROM invoices GROUP BY appointment_id HAVING count(*)>1 LIMIT 1').get())blockers.push('Duplicate legacy invoices require review');
  if(sql.prepare("SELECT id FROM appointments WHERE status IN ('booked','confirmed','rescheduled') AND (google_event_id IS NULL OR google_event_id LIKE 'local_%' OR google_event_id LIKE 'cal_%') LIMIT 1").get())blockers.push('Active appointments require real calendar reconciliation');
 }
 const counts:Record<string,number>={};
 for(const [key,query] of Object.entries({calendarOperations:'SELECT count(*) AS n FROM calendar_operations',outboundReview:"SELECT count(*) AS n FROM outbound_jobs WHERE status='review'",inboundReview:"SELECT count(*) AS n FROM inbound_jobs WHERE status='review'",replicationBacklog:'SELECT count(*) AS n FROM replication_jobs',pendingAlerts:"SELECT count(*) AS n FROM admin_alerts WHERE status='pending'"}))counts[key]=Number((sql.prepare(query).get() as any).n);
 return {ready:blockers.length===0,mode:cfg.mode || 'clinic',blockers,counts};
}
