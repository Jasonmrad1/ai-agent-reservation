import { DatabaseContext } from '../db/index.js';
import { WhatsAppGateway } from '../twilio/client.js';
import { SchedulingEngine } from '../calendar/scheduler.js';
import { AdminNotificationService } from '../notifications/admin.notifier.js';
import { formatEnglishDate } from '../gemini/agent.js';
import {isAppointmentConfirmation} from '../utils/patient-commands.js';

export interface ReminderRunnerOptions {
  db: DatabaseContext;
  gateway: WhatsAppGateway;
  scheduler?: SchedulingEngine;
  notifier?: AdminNotificationService;
}

export class ReminderRunner {
  private db: DatabaseContext;
  private gateway: WhatsAppGateway;
  private scheduler?: SchedulingEngine;
  private notifier?: AdminNotificationService;

  constructor(options: ReminderRunnerOptions) {
    this.db = options.db;
    this.gateway = options.gateway;
    this.scheduler = options.scheduler;
    this.notifier = options.notifier;
  }

  /**
   * Scans and sends 24-hour reminders.
   * Returns count of reminders sent.
   */
  public async send24HourReminders(now: Date = new Date()): Promise<number> {
    const pending = this.db.appointments.getPendingReminders('24h', now);
    let sentCount = 0;

    for (const appt of pending) {
      const key=`reminder:24h:${appt.id}:${appt.start_time}`;
      if (!this.claim(key,appt.id)) continue;
      const visitInfo = appt.visit_type === 'home_visit'
        ? `🏠 Home Visit (at ${appt.address || 'your address'})`
        : `🏥 In-Office Visit at Dr. Ziad El Khoury's Clinic`;

      const timeStr = formatEnglishDate(appt.start_time);

      const body = [
        `👋 Hi ${appt.customer_name || 'there'}! This is a reminder for your upcoming appointment with Dr. Ziad El Khoury:`,
        `🩺 Service: ${appt.service}`,
        `🕒 Time: ${timeStr}`,
        `📍 ${visitInfo}`,
        ``,
        `• Reply *YES* to confirm`,
        `• Reply *RESCHEDULE* (or send a new time) to move your visit`,
        `• Reply *CANCEL* to cancel your reservation`,
      ].join('\n');

      try {
        const sendRes = await this.gateway.sendMessage(appt.customer_phone, body, appt.customer_id,{category:'reminder',idempotencyKey:key,appointmentId:appt.id,expectedStart:appt.start_time,expiresAt:appt.start_time,variables:{'1':formatEnglishDate(appt.start_time),'2':appt.visit_type==='home_visit' ? appt.address || 'Home visit' : 'Clinic'}});
        this.db.appointments.markReminderSent(appt.id, '24h');

        const conv = this.db.conversations.getOrCreateActive(appt.customer_id);
        this.db.messages.create(conv.id, 'outbound', body, sendRes.messageSid, 'sent');
        sentCount++;
      } catch (err: any) {
        this.releaseUnqueuedClaim(key);
        // Log alert if sending fails
        this.db.alerts.create({
          type: 'delivery_failure',
          title: `24h Reminder Failed for ${appt.customer_phone}`,
          details: `Appointment ID: ${appt.id}. Error: ${err?.message || err}`,
          customer_id: appt.customer_id,
        });
      }
    }

    return sentCount;
  }

  /**
   * Scans and sends 1-hour reminders.
   * Returns count of reminders sent.
   */
  public async send1HourReminders(now: Date = new Date()): Promise<number> {
    const pending = this.db.appointments.getPendingReminders('1h', now);
    let sentCount = 0;

    for (const appt of pending) {
      const key=`reminder:1h:${appt.id}:${appt.start_time}`;
      if (!this.claim(key,appt.id)) continue;
      const timeStr = new Date(appt.start_time).toLocaleTimeString('en-US', {
        timeZone: 'Asia/Beirut',
        hour: '2-digit',
        minute: '2-digit',
      });

      const locationStr = appt.visit_type === 'home_visit'
        ? `Your home visit is scheduled at ${appt.address}`
        : `See you at our clinic`;

      const body = `👋 Reminder: Your appointment for ${appt.service} is coming up in about 1 hour (${timeStr}). ${locationStr}!`;

      try {
        const sendRes = await this.gateway.sendMessage(appt.customer_phone, body, appt.customer_id,{category:'reminder',idempotencyKey:key,appointmentId:appt.id,expectedStart:appt.start_time,expiresAt:appt.start_time,variables:{'1':formatEnglishDate(appt.start_time),'2':appt.visit_type==='home_visit' ? appt.address || 'Home visit' : 'Clinic'}});
        this.db.appointments.markReminderSent(appt.id, '1h');

        const conv = this.db.conversations.getOrCreateActive(appt.customer_id);
        this.db.messages.create(conv.id, 'outbound', body, sendRes.messageSid, 'sent');
        sentCount++;
      } catch (err: any) {
        this.releaseUnqueuedClaim(key);
        this.db.alerts.create({
          type: 'delivery_failure',
          title: `1h Reminder Failed for ${appt.customer_phone}`,
          details: `Appointment ID: ${appt.id}. Error: ${err?.message || err}`,
          customer_id: appt.customer_id,
        });
      }
    }

    return sentCount;
  }

  private claim(key:string,appointmentId:string):boolean {
    return !!this.db.appDb.db.prepare('INSERT OR IGNORE INTO reminder_claims (claim_key,appointment_id,created_at) VALUES (?,?,?)').run(key,appointmentId,new Date().toISOString()).changes;
  }
  private releaseUnqueuedClaim(key:string):void {
    if (!this.db.appDb.db.prepare('SELECT id FROM outbound_jobs WHERE idempotency_key=?').get(key)) this.db.appDb.db.prepare('DELETE FROM reminder_claims WHERE claim_key=?').run(key);
  }

  /**
   * Checks if incoming text is a direct confirmation or cancellation response (YES / CONFIRM / CANCEL / RESCHEDULE)
   */
  public handleConfirmationResponse(customerId: string, text: string): string | null | Promise<string> {
    const clean = text.trim();
    const upper = clean.toUpperCase();
    if (this.db.appointments.findUpcomingByCustomerId(customerId).length > 1) return null;

    // Only intercept if customer has an active upcoming appointment
    const active = this.db.appointments.findLatestActiveByCustomerId(customerId);
    if (!active) {
      return null;
    }

    // Only intercept short exact commands (not complex multi-word conversational sentences)
    const wordCount = clean.split(/\s+/).length;
    if (wordCount > 3) {
      return null;
    }

    // 1. Direct Confirmation
    if (isAppointmentConfirmation(clean)) {
      // A short answer belongs to the booking question currently in progress.
      if(this.db.workflows.findActiveByCustomerId(customerId)) return null;
      this.db.appointments.updateStatus(active.id, 'confirmed');
      return 'Thank you! Your appointment has been confirmed with Dr. Ziad El Khoury. We look forward to seeing you!';
    }

    // 2. Direct Cancellation from WhatsApp reminder
    if (
      upper === 'CANCEL' ||
      upper === 'CANCEL APPOINTMENT' ||
      upper === 'CANCEL RESERVATION' ||
      upper === 'ILGHA' ||
      upper === 'LAGHE' ||
      upper === 'MA BADDI MAW3AD'
    ) {
      const active = this.db.appointments.findLatestActiveByCustomerId(customerId);
      if (active) {
        return (async () => {
        if (!this.scheduler) throw new Error('Scheduler is required for cancellation');
        await this.scheduler.cancelAppointment(active.id, 'Cancelled directly by patient via WhatsApp reminder');

        // Notify Doctor on WhatsApp
        if (this.notifier) {
          const cust = this.db.customers.findById(customerId);
          if (cust) {
            this.notifier.notifyCancellation(active, cust, 'Patient cancelled directly via WhatsApp reminder').catch(() => {});
          }
        }

        const dateFormatted = formatEnglishDate(active.start_time);
        return `Your appointment for ${active.service} on ${dateFormatted} has been cancelled as requested. We hope to see you again soon!`;
        })();
      }
      return 'You currently have no active appointment to cancel.';
    }

    // 3. Direct Reschedule Intent
    if (upper === 'RESCHEDULE' || upper === 'MOVE' || upper === 'TA2JEEL' || upper === 'GHAYYIR') {
      return 'No problem! What new day and time would you like to move your appointment to? You can tell me your preferred slot or ask for our open hours this week.';
    }

    return null;
  }
}
