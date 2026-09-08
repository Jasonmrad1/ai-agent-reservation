import { WhatsAppGateway } from '../twilio/client.js';
import { AdminAlertRepository } from '../db/repositories/alert.repo.js';
import { Appointment, Customer } from '../types/index.js';

export interface AdminNotifierOptions {
  gateway: WhatsAppGateway;
  adminWhatsappNumber: string;
  alerts: AdminAlertRepository;
}

export class AdminNotificationService {
  private gateway: WhatsAppGateway;
  private adminNumber: string;
  private alerts: AdminAlertRepository;

  constructor(options: AdminNotifierOptions) {
    this.gateway = options.gateway;
    this.adminNumber = options.adminWhatsappNumber;
    this.alerts = options.alerts;
  }

  private async send(message: string, alertTitle: string, alertDetails: string): Promise<void> {
    try {
      await this.gateway.sendMessage(this.adminNumber, message);
    } catch (err: any) {
      // If admin notification fails, log alert in DB so it appears on admin dashboard
      this.alerts.create({
        type: 'delivery_failure',
        title: `Failed Admin Notification: ${alertTitle}`,
        details: `${alertDetails}. Error: ${err?.message || err}`,
      });
    }
  }

  public async notifyBooking(appointment: Appointment, customer: Customer): Promise<void> {
    const custDigits = (customer.phone || '').replace(/\D/g, '');
    const adminDigits = (this.adminNumber || '').replace(/\D/g, '');
    if (custDigits && adminDigits && custDigits === adminDigits) {
      this.alerts.create({
        type: 'booking_alert',
        title: `New Booking: ${customer.name || customer.phone}`,
        details: `${appointment.service} on ${appointment.start_time}`,
        customer_id: customer.id,
      });
      return;
    }

    const visitDetails = appointment.visit_type === 'home_visit'
      ? `🏠 Home Visit\n📍 Address: ${appointment.address || 'Not specified'}`
      : `🏥 In-Office Visit`;

    const waLink = custDigits ? `https://wa.me/${custDigits}` : '';

    const msg = [
      `🔔 *NEW APPOINTMENT BOOKED*`,
      `👤 Patient: ${customer.name || 'Unknown'} (${customer.phone})`,
      `🩺 Service: ${appointment.service}`,
      `📅 Time: ${appointment.start_time}`,
      `💰 Fee: $${appointment.price}`,
      visitDetails,
      appointment.notes ? `📝 Notes: ${appointment.notes}` : '',
      waLink ? `📲 Chat with Patient: ${waLink}` : '',
    ].filter(Boolean).join('\n');

    await this.send(msg, 'New Booking Alert', `Appt ID: ${appointment.id}`);
  }

  public async notifyReschedule(appointment: Appointment, customer: Customer, oldStartTime?: string): Promise<void> {
    const custDigits = (customer.phone || '').replace(/\D/g, '');
    const adminDigits = (this.adminNumber || '').replace(/\D/g, '');
    if (custDigits && adminDigits && custDigits === adminDigits) {
      this.alerts.create({
        type: 'schedule_conflict',
        title: `Rescheduled: ${customer.name || customer.phone}`,
        details: `${appointment.service} moved to ${appointment.start_time}`,
        customer_id: customer.id,
      });
      return;
    }

    const waLink = custDigits ? `https://wa.me/${custDigits}` : '';

    const msg = [
      `🔄 *APPOINTMENT RESCHEDULED*`,
      `👤 Patient: ${customer.name || 'Unknown'} (${customer.phone})`,
      `🩺 Service: ${appointment.service}`,
      oldStartTime ? `⏮ Previous Time: ${oldStartTime}` : '',
      `⏭ New Time: ${appointment.start_time}`,
      `📍 Type: ${appointment.visit_type === 'home_visit' ? `Home Visit (${appointment.address})` : 'In-Office'}`,
      waLink ? `📲 Chat with Patient: ${waLink}` : '',
    ].filter(Boolean).join('\n');

    await this.send(msg, 'Rescheduled Appointment', `Appt ID: ${appointment.id}`);
  }

  public async notifyCancellation(appointment: Appointment, customer: Customer, reason?: string): Promise<void> {
    const custDigits = (customer.phone || '').replace(/\D/g, '');
    const adminDigits = (this.adminNumber || '').replace(/\D/g, '');
    if (custDigits && adminDigits && custDigits === adminDigits) {
      this.alerts.create({
        type: 'schedule_conflict',
        title: `Cancelled: ${customer.name || customer.phone}`,
        details: `${appointment.service} on ${appointment.start_time} (${reason || 'No reason'})`,
        customer_id: customer.id,
      });
      return;
    }

    const waLink = custDigits ? `https://wa.me/${custDigits}` : '';

    const msg = [
      `❌ *APPOINTMENT CANCELLED*`,
      `👤 Patient: ${customer.name || 'Unknown'} (${customer.phone})`,
      `🩺 Service: ${appointment.service}`,
      `📅 Time: ${appointment.start_time}`,
      reason ? `📝 Reason: ${reason}` : '',
      waLink ? `📲 Chat with Patient: ${waLink}` : '',
    ].filter(Boolean).join('\n');

    await this.send(msg, 'Cancellation Alert', `Appt ID: ${appointment.id}`);
  }

  public async notifyEscalation(customer: Customer, reason: string, urgency: string = 'medium'): Promise<void> {
    const rawDigits = (customer.phone || '').replace(/\D/g, '');
    const waLink = rawDigits ? `https://wa.me/${rawDigits}` : '';

    const msg = [
      `🚨 *HUMAN HANDOFF REQUESTED*`,
      `👤 Patient: ${customer.name || 'Unknown'} (${customer.phone})`,
      `⚠️ Urgency: ${urgency.toUpperCase()}`,
      `💬 Reason: ${reason}`,
      waLink ? `\n📲 *Chat directly on WhatsApp Business:*\n${waLink}` : '',
      `\nPlease tap the link above or open WhatsApp Business to message the patient directly.`,
    ].filter(Boolean).join('\n');

    await this.send(msg, 'Human Escalation', `Patient: ${customer.phone}`);
  }
}
