import {it,expect} from 'vitest';import {createDatabaseContext} from '../src/db/index.js';import {ReminderRunner} from '../src/reminders/runner.js';import {MockWhatsAppGateway} from '../src/twilio/client.js';
import {DurableWhatsAppGateway} from '../src/twilio/durable.js';
it('records a reminder accepted later by the recovery worker',async()=>{
 const {db,gateway,a}=fixture();const outbox=new DurableWhatsAppGateway(db,gateway);const runner=new ReminderRunner({db,gateway:outbox});gateway.shouldFail=true;
 await runner.send24HourReminders(new Date('2026-09-01T12:00:00Z'));expect(db.appointments.findById(a.id)?.reminder_24h_sent).toBe(false);
 gateway.shouldFail=false;await outbox.drain(true);expect(db.appointments.findById(a.id)?.reminder_24h_sent).toBe(true);expect(gateway.sentMessages).toHaveLength(1);
});
function fixture(){const db=createDatabaseContext(':memory:');const gateway=new MockWhatsAppGateway();const c=db.customers.findOrCreate('+96171000111');const a=db.appointments.create({customer_id:c.id,service:'Consultation',visit_type:'home_visit',address:'Beirut',start_time:'2026-09-02T07:00:00.000Z',end_time:'2026-09-02T08:00:00.000Z',price:100});return{db,gateway,a};}
it('catches up a missed 24-hour reminder after a restart',async()=>{const {db,gateway}=fixture();const r=new ReminderRunner({db,gateway});expect(await r.send24HourReminders(new Date('2026-09-01T12:00:00Z'))).toBe(1);});
it('claims reminders atomically across two runners and avoids invented travel updates',async()=>{const {db,gateway}=fixture();const r1=new ReminderRunner({db,gateway});const r2=new ReminderRunner({db,gateway});await Promise.all([r1.send1HourReminders(new Date('2026-09-02T06:00:00Z')),r2.send1HourReminders(new Date('2026-09-02T06:00:00Z'))]);expect(gateway.sentMessages).toHaveLength(1);expect(gateway.sentMessages[0].body).not.toContain('on the way');});
