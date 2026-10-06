import crypto from 'node:crypto';
import { DatabaseContext } from '../db/index.js';
import { WhatsAppGateway, SendMessageResult } from './client.js';

/** Persist intent before sending. Uncertain provider writes require human reconciliation. */
export class DurableWhatsAppGateway implements WhatsAppGateway {
  private active = new Set<string>();
  constructor(private db: DatabaseContext, private provider: WhatsAppGateway) {}
  async sendMessage(to: string, body: string, customerId?: string): Promise<SendMessageResult> {
    const id=crypto.randomUUID();
    const customer=customerId ? this.db.customers.findById(customerId) : this.db.customers.findOrCreate(to);
    if (!customer) throw new Error('Message recipient is missing');
    const conv=this.db.conversations.getOrCreateActive(customer.id);
    this.db.appDb.db.prepare("INSERT INTO outbound_jobs (id,recipient,body,customer_id,conversation_id,status,created_at) VALUES (?,?,?,?,?,'pending',?)").run(id,to,body,customer.id,conv.id,new Date().toISOString());
    this.db.messages.create(conv.id,'outbound',body,'OUTBOX_'+id,'queued');
    return this.attempt(id);
  }
  private async attempt(id:string):Promise<SendMessageResult> {
    if (this.active.has(id)) throw new Error('Message send already in progress');
    this.active.add(id);
    const sql=this.db.appDb.db;const job=sql.prepare('SELECT * FROM outbound_jobs WHERE id=?').get(id) as any;
    try {
      sql.prepare("UPDATE outbound_jobs SET status='sending',attempts=attempts+1 WHERE id=?").run(id);
      const result=await this.provider.sendMessage(job.recipient,job.body,job.customer_id);
      sql.exec('BEGIN IMMEDIATE');
      try {
        sql.prepare("UPDATE outbound_jobs SET status='accepted',message_sid=?,last_error=NULL WHERE id=?").run(result.messageSid,id);
        sql.prepare('UPDATE messages SET message_sid=?,status=? WHERE message_sid=?').run(result.messageSid,result.status,'OUTBOX_'+id);
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
    const interrupted=this.db.appDb.db.prepare("SELECT id FROM outbound_jobs WHERE status='sending'").all();
    this.db.appDb.db.prepare("UPDATE outbound_jobs SET status='review' WHERE status='sending'").run();
    if(interrupted.length) this.db.alerts.create({type:'delivery_failure',title:'Interrupted WhatsApp sends need review',details:`${interrupted.length} sends have unknown provider outcomes. Check Twilio before retrying.`});
  }
}
