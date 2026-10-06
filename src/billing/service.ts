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
  public async createInvoiceForAppointment(appointmentId: string): Promise<Invoice> {
    const appt = this.db.appointments.findById(appointmentId);
    if (!appt) {
      throw new Error(`Appointment ${appointmentId} not found.`);
    }

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
      `Payment instructions: Payments can be settled in cash, debit/credit card, or bank transfer.`,
      `Thank you for choosing Dr. Smith's Medical Practice!`,
    ].join('\n');

    try {
      const sendRes = await this.gateway.sendMessage(customer.phone, body, customer.id);
      const conv = this.db.conversations.getOrCreateActive(customer.id);
      this.db.messages.create(conv.id, 'outbound', body, sendRes.messageSid, 'sent');
    } catch (err: any) {
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

    this.db.invoices.markPaid(invoiceId);
    const updated = this.db.invoices.findById(invoiceId)!;

    const customer = this.db.customers.findById(updated.customer_id);
    if (customer && !customer.opted_out) {
      const receiptMsg = [
        `✅ *PAYMENT CONFIRMATION*`,
        `Thank you, ${customer.name || 'Patient'}!`,
        `We have received your payment of $${updated.amount.toFixed(2)} for ${updated.service_description}.`,
        `Invoice #: ${updated.id.substring(0, 8).toUpperCase()}`,
        `Status: PAID in full.`,
      ].join('\n');

      try {
        const sendRes = await this.gateway.sendMessage(customer.phone, receiptMsg, customer.id);
        const conv = this.db.conversations.getOrCreateActive(customer.id);
        this.db.messages.create(conv.id, 'outbound', receiptMsg, sendRes.messageSid, 'sent');
      } catch {
        // Non-blocking for receipt
      }
    }

    return updated;
  }

  /**
   * Marks appointment as completed, generates invoice, and dispatches it.
   */
  public async completeAppointmentAndBill(appointmentId: string): Promise<{ appointment: Appointment; invoice: Invoice }> {
    this.db.appointments.updateStatus(appointmentId, 'completed');
    const appointment = this.db.appointments.findById(appointmentId)!;

    const invoice = await this.createInvoiceForAppointment(appointmentId);
    await this.sendInvoiceToCustomer(invoice.id);

    return { appointment, invoice };
  }
}
