import { DatabaseContext } from '../db/index.js';
import { WhatsAppGateway } from '../twilio/client.js';
import { Invoice, Appointment } from '../types/index.js';

export interface BillingServiceOptions {
  db: DatabaseContext;
  gateway: WhatsAppGateway;
}

export class BillingService {
  private db: DatabaseContext;
  private gateway: WhatsAppGateway;

  constructor(options: BillingServiceOptions) {
    this.db = options.db;
    this.gateway = options.gateway;
  }

  /**
   * Generates a formal invoice for an appointment.
   * Grounded strictly in the actual appointment record (no AI hallucination).
   */
  public async createInvoiceForAppointment(appointmentId: string): Promise<Invoice> {return this.createInvoice(appointmentId);}

  private createInvoice(appointmentId:string):Invoice {
    const appt = this.db.appointments.findById(appointmentId);
    if (!appt) {
      throw new Error(`Appointment ${appointmentId} not found.`);
    }

    if(!Number.isFinite(appt.price) || appt.price<0) throw new Error('Invalid invoice amount');
    if(appt.status==='cancelled') throw new Error('Cannot invoice a cancelled or inactive appointment');
    const existing = this.db.invoices.findByAppointmentId(appointmentId);
    if (existing) {
      return existing; // Idempotent: do not duplicate invoice
    }

    const invoice = this.db.invoices.create({
      appointment_id: appt.id,
      customer_id: appt.customer_id,
      service_description: appt.service,
      amount: appt.price,
      currency: 'USD',
    });

    return invoice;
  }

  /**
   * Sends the generated invoice to the customer via WhatsApp.
   */
  public async sendInvoiceToCustomer(invoiceId: string): Promise<void> {
    const invoice = this.db.invoices.findById(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found.`);
    }

    const customer = this.db.customers.findById(invoice.customer_id);
    if (!customer) {
      throw new Error(`Customer for invoice ${invoiceId} not found.`);
    }

    if(customer.opted_out) return;
    const notificationKey=`invoice:${invoice.id}:${invoice.status}`;
    if(!this.claimNotification(notificationKey)) return;
    const appt = this.db.appointments.findById(invoice.appointment_id);
    const dateStr = appt ? new Date(appt.start_time).toLocaleDateString('en-US', {
      timeZone: 'Asia/Beirut',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }) : 'Recent';

    const body = [
      `🧾 *INVOICE / RECEIPT*`,
      `Invoice #: ${invoice.id.substring(0, 8).toUpperCase()}`,
      `Patient: ${customer.name || customer.phone}`,
      `Service: ${invoice.service_description}`,
      `Date of Service: ${dateStr}`,
      `Total Amount: $${invoice.amount.toFixed(2)} ${invoice.currency}`,
      `Status: *${invoice.status.toUpperCase()}*`,
      ``,
      `Payment instructions: ${this.db.settings.get('payment_instructions','Please contact the clinic for payment instructions.')}`,
      `Thank you for choosing ${this.db.settings.get('clinic_name', "Dr. Ziad El Khoury's Clinic")}!`,
    ].join('\n');

    try {
      const sendRes = await this.gateway.sendMessage(customer.phone, body, customer.id,{category:'invoice',idempotencyKey:notificationKey,variables:{'1':invoice.id.substring(0,8).toUpperCase(),'2':invoice.amount.toFixed(2),'3':invoice.status}});
      const conv = this.db.conversations.getOrCreateActive(customer.id);
      this.db.messages.create(conv.id, 'outbound', body, sendRes.messageSid, 'sent');
    } catch (err: any) {
      this.releaseUnqueuedNotification(notificationKey);
      this.db.alerts.create({
        type: 'delivery_failure',
        title: `Invoice Send Failed for ${customer.phone}`,
        details: `Invoice ID: ${invoice.id}. Error: ${err?.message || err}`,
        customer_id: customer.id,
      });
      throw err;
    }
  }

  /**
   * Marks an invoice as paid and sends a payment receipt to the patient.
   */
  public async markInvoicePaid(invoiceId: string): Promise<Invoice> {
    const invoice = this.db.invoices.findById(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found.`);
    }

    if(invoice.status==='paid') return invoice;
    if(invoice.status!=='unpaid') throw new Error('Only unpaid invoices can be paid');
    this.db.invoices.markPaid(invoiceId);
    const updated = this.db.invoices.findById(invoiceId)!;

    const customer = this.db.customers.findById(updated.customer_id);
    const notificationKey=`receipt:${invoiceId}:paid`;
    if (customer && !customer.opted_out && this.claimNotification(notificationKey)) {
      const receiptMsg = [
        `✅ *PAYMENT CONFIRMATION*`,
        `Thank you, ${customer.name || 'Patient'}!`,
        `We have received your payment of $${updated.amount.toFixed(2)} for ${updated.service_description}.`,
        `Invoice #: ${updated.id.substring(0, 8).toUpperCase()}`,
        `Status: PAID in full.`,
      ].join('\n');

      try {
        const sendRes = await this.gateway.sendMessage(customer.phone, receiptMsg, customer.id,{category:'invoice',idempotencyKey:notificationKey,variables:{'1':updated.id.substring(0,8).toUpperCase(),'2':updated.amount.toFixed(2),'3':'paid'}});
        const conv = this.db.conversations.getOrCreateActive(customer.id);
        this.db.messages.create(conv.id, 'outbound', receiptMsg, sendRes.messageSid, 'sent');
      } catch {
        this.releaseUnqueuedNotification(notificationKey);
        // Non-blocking for receipt
      }
    }

    return updated;
  }

  /**
   * Marks appointment as completed, generates invoice, and dispatches it.
   */
  private claimNotification(key:string):boolean {
    return !!this.db.appDb.db.prepare('INSERT OR IGNORE INTO billing_notifications(notification_key,created_at) VALUES (?,?)').run(key,new Date().toISOString()).changes;
  }
  private releaseUnqueuedNotification(key:string):void {
    if(!this.db.appDb.db.prepare('SELECT id FROM outbound_jobs WHERE idempotency_key=?').get(key)) this.db.appDb.db.prepare('DELETE FROM billing_notifications WHERE notification_key=?').run(key);
  }
  public async completeAppointmentAndBill(appointmentId:string):Promise<{appointment:Appointment;invoice:Invoice;notificationStatus:string}> {
    const current=this.db.appointments.findById(appointmentId);
    if(!current || !['booked','confirmed','rescheduled','completed'].includes(current.status)) throw new Error('Only active or completed appointments can be billed');
    const sql=this.db.appDb.db;let invoice:Invoice;
    sql.exec('BEGIN IMMEDIATE');
    try {
      this.db.appointments.updateStatus(appointmentId,'completed');
      invoice=this.createInvoice(appointmentId);
      sql.exec('COMMIT');
    } catch(error) {sql.exec('ROLLBACK');throw error;}
    let notificationStatus='accepted';
    if(this.db.customers.findById(current.customer_id)?.opted_out) notificationStatus='opted_out';
    else {try {await this.sendInvoiceToCustomer(invoice.id);}catch{notificationStatus='pending_review';}}
    return {appointment:this.db.appointments.findById(appointmentId)!,invoice,notificationStatus};
  }
}
