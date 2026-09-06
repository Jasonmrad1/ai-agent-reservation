import { DatabaseContext } from '../db/index.js';
import { WhatsAppGateway } from '../twilio/client.js';

export interface ReminderRunnerOptions {
  db: DatabaseContext;
  gateway: WhatsAppGateway;
}

export class ReminderRunner {
  private db: DatabaseContext;
  private gateway: WhatsAppGateway;

  constructor(options: ReminderRunnerOptions) {
    this.db = options.db;
    this.gateway = options.gateway;
  }

  /**
   * Scans and sends 24-hour reminders.
   * Returns count of reminders sent.
   */
  public async send24HourReminders(now: Date = new Date()): Promise<number> {
    const pending = this.db.appointments.getPendingReminders('24h', now);
    let sentCount = 0;

    for (const appt of pending) {
      const visitInfo = appt.visit_type === 'home_visit'
        ? `🏠 Home Visit (at ${appt.address || 'your address'})`
        : `🏥 In-Office Visit at Dr. Smith Clinic`;

      const timeStr = new Date(appt.start_time).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const body = [
        `👋 Hi ${appt.customer_name || 'there'}! This is a reminder for your upcoming appointment tomorrow:`,
        `🩺 Service: ${appt.service}`,
        `🕒 Time: ${timeStr}`,
        `📍 ${visitInfo}`,
        ``,
        `Please reply *YES* to confirm, or *MOVE* if you need to reschedule.`,
      ].join('\n');

      try {
        const sendRes = await this.gateway.sendMessage(appt.customer_phone, body, appt.customer_id);
        this.db.appointments.markReminderSent(appt.id, '24h');

        const conv = this.db.conversations.getOrCreateActive(appt.customer_id);
        this.db.messages.create(conv.id, 'outbound', body, sendRes.messageSid, 'sent');
        sentCount++;
      } catch (err: any) {
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
      const timeStr = new Date(appt.start_time).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const locationStr = appt.visit_type === 'home_visit'
        ? `Dr. Smith is on the way to ${appt.address}`
        : `See you at our clinic`;

      const body = `👋 Reminder: Your appointment for ${appt.service} is coming up in about 1 hour (${timeStr}). ${locationStr}!`;

      try {
        const sendRes = await this.gateway.sendMessage(appt.customer_phone, body, appt.customer_id);
        this.db.appointments.markReminderSent(appt.id, '1h');

        const conv = this.db.conversations.getOrCreateActive(appt.customer_id);
        this.db.messages.create(conv.id, 'outbound', body, sendRes.messageSid, 'sent');
        sentCount++;
      } catch (err: any) {
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

  /**
   * Checks if incoming text is a direct confirmation response (YES / CONFIRM)
   */
  public handleConfirmationResponse(customerId: string, text: string): string | null {
    const upper = text.trim().toUpperCase();
    if (upper === 'YES' || upper === 'CONFIRM') {
      const active = this.db.appointments.findLatestActiveByCustomerId(customerId);
      if (active) {
        this.db.appointments.updateStatus(active.id, 'confirmed');
        return 'Thank you! Your appointment has been confirmed. We look forward to seeing you!';
      }
      return 'Thank you for your response!';
    }
    return null;
  }
}
