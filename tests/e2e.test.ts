import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/index.js';

describe('Phase 8: End-to-End System Lifecycle Flow', () => {
  let appInstance: AppInstance;
  let gateway: MockWhatsAppGateway;
  let calendar: InMemoryCalendarProvider;
  let geminiClient: MockGeminiClient;
  const ADMIN_SECRET = 'super_secret_test_key';
  const CUSTOMER_PHONE = 'whatsapp:+15559998888';
  const ADMIN_PHONE = 'whatsapp:+15550001111';

  beforeEach(() => {
    const db = createDatabaseContext(':memory:');
    gateway = new MockWhatsAppGateway();
    calendar = new InMemoryCalendarProvider();
    geminiClient = new MockGeminiClient();

    appInstance = createApp({
      config: {
        port: 3000,
        databaseUrl: ':memory:',
        adminSessionSecret: ADMIN_SECRET,
        adminWhatsappNumber: ADMIN_PHONE,
        homeVisitBufferMinutes: 30,
        nodeEnv: 'test',
      },
      db,
      gateway,
      calendar,
      geminiClient,
      skipSignatureVerification: true,
    });
  });

  it('executes the complete customer booking, reminder, completion, and billing lifecycle', async () => {
    const { app, db, reminders } = appInstance;

    // 0. Health check
    const healthRes = await request(app).get('/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    // 1. Customer asks for availability for a home visit on Monday (2026-09-14)
    geminiClient.mockToolCall = {
      name: 'check_availability',
      args: { date: '2026-09-14', visit_type: 'home_visit' },
    };

    const availReq = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: CUSTOMER_PHONE,
        Body: 'Hi! Do you have home visit availability next Monday?',
        MessageSid: 'SM_E2E_001',
        ProfileName: 'Sarah Connor',
      });
    expect(availReq.status).toBe(200);

    // Verify WhatsApp reply to patient
    expect(gateway.sentMessages.length).toBe(1);
    expect(gateway.sentMessages[0].to).toBe(CUSTOMER_PHONE);
    expect(gateway.sentMessages[0].body).toContain('Available slots on 2026-09-14 (home_visit)');

    // 2. Customer chooses 10:00 and provides their home address
    gateway.clear();
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '10:00',
        visit_type: 'home_visit',
        service: 'Home Visit Care',
        address: '42 Cyberdyne Blvd, Los Angeles',
        customer_name: 'Sarah Connor',
      },
    };

    const bookReq = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: CUSTOMER_PHONE,
        Body: 'Please book me for 10am at 42 Cyberdyne Blvd',
        MessageSid: 'SM_E2E_002',
      });
    expect(bookReq.status).toBe(200);

    // Verify Patient got confirmation
    const patientBookingMsg = gateway.sentMessages.find((m) => m.to === CUSTOMER_PHONE);
    expect(patientBookingMsg).toBeDefined();
    expect(patientBookingMsg?.body).toContain('confirmed');

    // Verify Doctor (Admin) got notified over WhatsApp
    const adminAlertMsg = gateway.sentMessages.find((m) => m.to === ADMIN_PHONE);
    expect(adminAlertMsg).toBeDefined();
    expect(adminAlertMsg?.body).toContain('NEW APPOINTMENT BOOKED');
    expect(adminAlertMsg?.body).toContain('42 Cyberdyne Blvd');

    // Verify Calendar Event was created
    const calEvents = await calendar.listEvents(
      new Date('2026-09-14T08:00:00.000Z'),
      new Date('2026-09-14T14:00:00.000Z')
    );
    expect(calEvents.length).toBe(1);
    expect(calEvents[0].location).toBe('42 Cyberdyne Blvd, Los Angeles');

    // Retrieve appointment from DB
    const cust = db.customers.findByPhone(CUSTOMER_PHONE)!;
    const appt = db.appointments.findUpcomingByCustomerId(cust.id)[0];
    expect(appt.status).toBe('booked');
    expect(appt.price).toBe(180);

    // 3. 24-Hour Reminder Job triggers
    gateway.clear();
    const mock24hReference = new Date(new Date('2026-09-14T10:00:00.000Z').getTime() - 24 * 60 * 60 * 1000);
    const sent24Count = await reminders.send24HourReminders(mock24hReference);
    expect(sent24Count).toBe(1);

    const reminderMsg = gateway.sentMessages.find((m) => m.to === CUSTOMER_PHONE);
    expect(reminderMsg?.body).toContain('*YES* to confirm');
    expect(reminderMsg?.body).toContain('42 Cyberdyne Blvd');

    // 4. Customer replies "YES" via WhatsApp
    gateway.clear();
    geminiClient.mockToolCall = null; // direct confirmation handled before LLM
    const confirmReq = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: CUSTOMER_PHONE,
        Body: 'YES',
        MessageSid: 'SM_E2E_CONFIRM',
      });
    expect(confirmReq.status).toBe(200);

    const confirmationReply = gateway.sentMessages.find((m) => m.to === CUSTOMER_PHONE);
    expect(confirmationReply?.body).toContain('confirmed');

    // Verify appointment status updated to 'confirmed' in DB
    const confirmedAppt = db.appointments.findById(appt.id);
    expect(confirmedAppt?.status).toBe('confirmed');

    // 5. 1-Hour Reminder Job triggers
    gateway.clear();
    const mock1hReference = new Date(new Date('2026-09-14T10:00:00.000Z').getTime() - 60 * 60 * 1000);
    const sent1Count = await reminders.send1HourReminders(mock1hReference);
    expect(sent1Count).toBe(1);
    expect(gateway.sentMessages[0].body).toContain('in about 1 hour');

    // 6. Doctor completes appointment via Admin API / Dashboard
    gateway.clear();
    const completeRes = await request(app)
      .post(`/admin/api/appointments/${appt.id}/complete`)
      .set('Authorization', `Bearer ${ADMIN_SECRET}`);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.success).toBe(true);
    expect(completeRes.body.invoice.amount).toBe(180);

    // Verify Invoice WhatsApp message sent to patient
    const invoiceMsg = gateway.sentMessages.find((m) => m.to === CUSTOMER_PHONE);
    expect(invoiceMsg).toBeDefined();
    expect(invoiceMsg?.body).toContain('INVOICE / RECEIPT');
    expect(invoiceMsg?.body).toContain('$180.00 USD');

    // 7. Patient settles invoice, Admin marks invoice as paid
    gateway.clear();
    const invoiceId = completeRes.body.invoice.id;
    const payRes = await request(app)
      .post(`/admin/api/invoices/${invoiceId}/pay`)
      .set('Authorization', `Bearer ${ADMIN_SECRET}`);
    expect(payRes.status).toBe(200);
    expect(payRes.body.invoice.status).toBe('paid');

    // Verify Payment confirmation receipt sent to patient over WhatsApp
    const receiptMsg = gateway.sentMessages.find((m) => m.to === CUSTOMER_PHONE);
    expect(receiptMsg).toBeDefined();
    expect(receiptMsg?.body).toContain('PAYMENT CONFIRMATION');
    expect(receiptMsg?.body).toContain('$180.00');

    // 8. Admin reviews Dashboard HTML
    const dashRes = await request(app).get(`/admin/dashboard?key=${ADMIN_SECRET}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.text).toContain('Practice Management Dashboard');
  });
});
