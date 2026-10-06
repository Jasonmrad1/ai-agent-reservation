import crypto from 'node:crypto';
import { DatabaseContext } from '../db/index.js';
import { WhatsAppGateway, SendMessageResult, SendMessageOptions } from './client.js';

/** Persist intent before sending. Uncertain provider writes require human reconciliation. */
export class DurableWhatsAppGateway implements WhatsAppGateway {
  private active = new Set<string>();
  constructor(private db: DatabaseContext, private provider: WhatsAppGateway, private policy:{enforceWindow?:boolean;templates?:Record<string,string>}={}) {}
  async sendMessage(to: string, body: string, customerId?: string, options:SendMessageOptions={}): Promise<SendMessageResult> {
    const id=crypto.randomUUID();
    const customer=customerId ? this.db.customers.findById(customerId) : this.db.customers.findOrCreate(to);
    if (!customer) throw new Error('Message recipient is missing');
    if(options.idempotencyKey) {
      const existing=this.db.appDb.db.prepare('SELECT * FROM outbound_jobs WHERE idempotency_key=?').get(options.idempotencyKey) as any;
      if(existing) {
        if(existing.status!=='accepted' || !existing.message_sid) throw new Error(`Outbound job ${existing.id} is not accepted (${existing.status})`);
        return {messageSid:existing.message_sid,status:'sent',to:existing.recipient,body:existing.body};
      }
    }
    const conv=this.db.conversations.getOrCreateActive(customer.id);
    const sql=this.db.appDb.db;
    sql.exec('BEGIN IMMEDIATE');
    try {
      sql.prepare("INSERT INTO outbound_jobs (id,recipient,body,customer_id,conversation_id,status,created_at,options,idempotency_key) VALUES (?,?,?,?,?,'pending',?,?,?)").run(id,to,body,customer.id,conv.id,new Date().toISOString(),JSON.stringify(options),options.idempotencyKey || null);
      this.db.messages.create(conv.id,'outbound',body,'OUTBOX_'+id,'queued');
      sql.exec('COMMIT');
    } catch(error) {sql.exec('ROLLBACK');throw error;}
    return this.attempt(id);
  }
  private async attempt(id:string):Promise<SendMessageResult> {
    if (this.active.has(id)) throw new Error('Message send already in progress');
    this.active.add(id);
    const sql=this.db.appDb.db;let job:any;
    try {
      job=sql.prepare('SELECT * FROM outbound_jobs WHERE id=?').get(id);
      if(!job) throw new Error('Outbound job is missing');
      const claimed=sql.prepare("UPDATE outbound_jobs SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'").run(id);
      if(!claimed.changes){this.active.delete(id);return {messageSid:job.message_sid || 'OUTBOX_'+id,status:job.status==='accepted' ? 'sent' : 'queued',to:job.recipient,body:job.body};}
    } catch(error) {this.active.delete(id);throw error;}
    try {
      const options:SendMessageOptions=JSON.parse(job.options || '{}');
      if(options.appointmentId) {
        const appt=this.db.appointments.findById(options.appointmentId);
        if(!appt || !['booked','confirmed','rescheduled'].includes(appt.status) || appt.start_time!==options.expectedStart || (options.expiresAt && Date.now()>=new Date(options.expiresAt).getTime())) throw new Error('Reminder is stale or appointment is no longer active');
      }
      const customer=this.db.customers.findById(job.customer_id);
      if(customer?.opted_out && !options.allowOptOut) throw new Error('Recipient has opted out');
      if(this.policy.enforceWindow) {
        const latest=sql.prepare("SELECT messages.created_at FROM messages JOIN conversations ON conversations.id=messages.conversation_id WHERE conversations.customer_id=? AND messages.direction='inbound' ORDER BY messages.created_at DESC,messages.rowid DESC LIMIT 1").get(job.customer_id) as any;
        const windowOpen=latest && Date.now()-new Date(latest.created_at).getTime()<86400000;
        if(!windowOpen) {
          const contentSid=this.policy.templates?.[options.category || 'reply'];
          if(!contentSid || !options.variables) throw new Error('Approved WhatsApp template and variables are required outside the 24-hour window');
          options.contentSid=contentSid;
        }
      }
      const result=await this.provider.sendMessage(job.recipient,job.body,job.customer_id,options);
      sql.exec('BEGIN IMMEDIATE');
      try {
        sql.prepare("UPDATE outbound_jobs SET status='accepted',message_sid=?,last_error=NULL WHERE id=?").run(result.messageSid,id);
        sql.prepare('UPDATE messages SET message_sid=?,status=? WHERE message_sid=?').run(result.messageSid,result.status,'OUTBOX_'+id);
        if(options.category==='reminder' && options.appointmentId && options.expectedStart){
          const type=options.idempotencyKey?.split(':')[1];
          if(type==='24h' || type==='1h')sql.prepare(`UPDATE appointments SET reminder_${type==='24h' ? '24h' : '1h'}_sent=1 WHERE id=? AND start_time=? AND status IN ('booked','confirmed','rescheduled')`).run(options.appointmentId,options.expectedStart);
        }
        sql.exec('COMMIT');
      } catch(e) {sql.exec('ROLLBACK');throw e;}
      const callback=sql.prepare('SELECT status FROM message_status_events WHERE message_sid=?').get(result.messageSid) as any;
      if(callback) {sql.prepare('DELETE FROM message_status_events WHERE message_sid=?').run(result.messageSid);this.db.messages.updateStatusBySid(result.messageSid,callback.status);}
      return result;
    } catch(error:any) {
      const definitive=error.status===429 || error.status===400 || error.code===20429 || /Simulated WhatsApp/.test(error.message || '');
      const retryable=definitive && error.status!==400 && Number(job.attempts)<5;
      const status=retryable ? 'pending' : 'review';
      sql.prepare('UPDATE outbound_jobs SET status=?,last_error=?,next_attempt_at=? WHERE id=?').run(status,String(error.message || error).slice(0,500),new Date(Date.now()+Math.min(300000,1000*2**Number(job.attempts))).toISOString(),id);
      this.db.alerts.create({type:'delivery_failure',title:retryable ? 'WhatsApp send queued for retry' : 'Uncertain WhatsApp send: review before retry',details:`Outbound job ${id}; recipient ${job.recipient}`,customer_id:job.customer_id});
      throw error;
    } finally {this.active.delete(id);}
  }
  async drain(force=false):Promise<void> {
    const jobs=this.db.appDb.db.prepare("SELECT id FROM outbound_jobs WHERE status='pending' AND (? OR next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,rowid LIMIT 50").all(force ? 1 : 0,new Date().toISOString());
    for(const job of jobs) {try {await this.attempt(String(job.id));}catch{/* Durable status and alert retained. */}}
  }
  recoverInterrupted():void {
    this.db.appDb.db.prepare('DELETE FROM reminder_claims WHERE claim_key NOT IN (SELECT idempotency_key FROM outbound_jobs WHERE idempotency_key IS NOT NULL)').run();
    const interrupted=this.db.appDb.db.prepare("SELECT id FROM outbound_jobs WHERE status='sending'").all();
    this.db.appDb.db.prepare("UPDATE outbound_jobs SET status='review' WHERE status='sending'").run();
    if(interrupted.length) this.db.alerts.create({type:'delivery_failure',title:'Interrupted WhatsApp sends need review',details:`${interrupted.length} sends have unknown provider outcomes. Check Twilio before retrying.`});
  }
}
