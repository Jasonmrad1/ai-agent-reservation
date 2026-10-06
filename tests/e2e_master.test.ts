import { clinicIso } from './clinic-time.js';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/index.js';

describe('🏆 MASTER END-TO-END CLINIC LIFECYCLE SUITE (DR. ZIAD EL KHOURY)', () => {
  let appInstance: AppInstance;
  let gateway: MockWhatsAppGateway;
  let calendar: InMemoryCalendarProvider;
  let geminiClient: MockGeminiClient;

  const ADMIN_SECRET = 'dr_ziad_secret_key_2026';
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';
  const DOCTOR_PHONE = 'whatsapp:+96171476193';
  const PATIENT_PHONE = 'whatsapp:+96170987654';
  const PATIENT_NAME = 'Joe Haddad';

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
        adminWhatsappNumber: DOCTOR_PHONE,
        twilioWhatsappNumber: CLINIC_WHATSAPP,
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

  it('orchestrates the entire multi-channel journey: Dr direct chat -> Patient Arabizi booking -> Reschedule -> Doctor phone assistant -> Reminders -> Invoice & Receipt', async () => {
    const { app, db, reminders } = appInstance;

    // =========================================================================
    // STEP 1: Dr. Ziad chats directly with patient from Clinic WhatsApp
    // =========================================================================
    const drChatRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: CLINIC_WHATSAPP,
        To: PATIENT_PHONE,
        Body: 'Bonjour Joe, kif sar dahrak lyom? Khod hal dawa 3al ree2.',
        MessageSid: 'SM_DR_DIRECT_01',
      });
    expect(drChatRes.status).toBe(200);

    // Verify conversation marked as doctor_active
    const cust0 = db.customers.findByPhone(PATIENT_PHONE)!;
    expect(cust0).toBeDefined();
    const convo1 = db.conversations.findActiveByCustomerId(cust0.id);
    expect(convo1?.status).toBe('doctor_active');

    // =========================================================================
    // STEP 2: Patient replies casually -> AI yields without interfering
    // =========================================================================
    gateway.clear();
    const patientCasualRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Merci ktir hakim, 3am ba3mol hek w ktir erteht!',
        MessageSid: 'SM_PATIENT_CASUAL_01',
        ProfileName: PATIENT_NAME,
      });
    expect(patientCasualRes.status).toBe(200);
    expect(gateway.sentMessages.length).toBe(0); // AI remained silent

    // =========================================================================
    await request(app).post('/api/webhook/whatsapp').send({From:PATIENT_PHONE,Body:'/resume bot',MessageSid:'SM_EXPLICIT_RESUME'});
    gateway.clear();

    // STEP 3: Patient explicitly requests a booking in Lebanese Arabizi
    // "Hakim bde maw3ad bkra tnen aal 10 bil 3iyade"
    // =========================================================================
    gateway.clear();
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '10:00',
        visit_type: 'in_office',
        service: 'General Consultation',
        customer_name: PATIENT_NAME,
      },
    };

    const patientBookRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Hakim bde maw3ad 2026-09-14 aal 10 bil 3iyade kermel dahre',
        MessageSid: 'SM_PATIENT_BOOK_01',
        ProfileName: PATIENT_NAME,
      });
    expect(patientBookRes.status).toBe(200);

    // Verify patient received confirmation
    const patientBookingConfirm = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientBookingConfirm).toBeDefined();
    expect(patientBookingConfirm?.body).toMatch(/confirmed|Zabbattelak/i);

    // Verify Dr. Ziad received WhatsApp alert on his personal phone
    const doctorAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(doctorAlert).toBeDefined();
    expect(doctorAlert?.body).toContain('NEW APPOINTMENT BOOKED');
    expect(doctorAlert?.body).toContain(PATIENT_NAME);

    // Verify appointment in DB and Calendar
    const cust = db.customers.findByPhone(PATIENT_PHONE)!;
    expect(cust).toBeDefined();
    const appointments = db.appointments.findUpcomingByCustomerId(cust.id);
    expect(appointments.length).toBe(1);
    const appt = appointments[0];
    expect(appt.visit_type).toBe('in_office');
    expect(appt.start_time).toBe(clinicIso('2026-09-14T10:00:00.000Z'));

    // =========================================================================
    // STEP 4: Patient requests to reschedule to Tuesday 11:00 AM
    // =========================================================================
    gateway.clear();
    geminiClient.mockToolCall = {
      name: 'reschedule_appointment',
      args: {
        new_date: '2026-09-15',
        new_time: '11:00',
      },
    };

    const rescheduleRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Hakim bde ghayyir l maw3ad lal tleta se3a 11:00 AM eza bseer',
        MessageSid: 'SM_PATIENT_RESCHEDULE_01',
      });
    expect(rescheduleRes.status).toBe(200);

    // Verify patient got rescheduled confirmation
    const rescheduleConfirm = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(rescheduleConfirm).toBeDefined();

    // Verify Dr. Ziad received reschedule notification
    const drRescheduleAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(drRescheduleAlert).toBeDefined();
    expect(drRescheduleAlert?.body).toContain('APPOINTMENT RESCHEDULED');

    const updatedAppt = db.appointments.findById(appt.id)!;
    expect(updatedAppt.start_time).toBe(clinicIso('2026-09-15T11:00:00.000Z'));

    // =========================================================================
    // STEP 5: Dr. Ziad uses his personal phone to query his Schedule Overview
    // =========================================================================
    gateway.clear();
    const drScheduleQueryRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: DOCTOR_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Show me my schedule for this week',
        MessageSid: 'SM_DR_QUERY_01',
      });
    expect(drScheduleQueryRes.status).toBe(200);

    const drScheduleReply = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(drScheduleReply).toBeDefined();
    expect(drScheduleReply?.body).toContain('Doctor Schedule Overview');
    expect(drScheduleReply?.body).toContain(PATIENT_NAME);

    // =========================================================================
    // STEP 6: Dr. Ziad blocks out a holiday from his personal phone
    // =========================================================================
    gateway.clear();
    const drBlockRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: DOCTOR_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Block 2026-09-18 day off',
        MessageSid: 'SM_DR_BLOCK_01',
      });
    expect(drBlockRes.status).toBe(200);

    const drBlockReply = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(drBlockReply).toBeDefined();
    expect(drBlockReply?.body).toContain('blocked out 2026-09-18');

    // Verify override saved in DB
    const override = db.availability.getOverrideForDate('2026-09-18');
    expect(override).toBeDefined();
    expect(override?.is_unavailable).toBe(true);

    // =========================================================================
    // STEP 7: 24-Hour Automated WhatsApp Reminder & Confirmation Flow
    // =========================================================================
    gateway.clear();
    const ref24h = new Date(new Date(clinicIso('2026-09-15T11:00:00.000Z')).getTime() - 24 * 60 * 60 * 1000);
    const reminders24Count = await reminders.send24HourReminders(ref24h);
    expect(reminders24Count).toBe(1);

    const reminderMsg = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(reminderMsg).toBeDefined();
    expect(reminderMsg?.body).toContain('*YES* to confirm');

    // Patient replies "YES" to confirm
    gateway.clear();
    const confirmReplyRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'YES',
        MessageSid: 'SM_PATIENT_YES_01',
      });
    expect(confirmReplyRes.status).toBe(200);

    const confirmedApptState = db.appointments.findById(appt.id)!;
    expect(confirmedApptState.status).toBe('confirmed');

    // =========================================================================
    // STEP 8: 1-Hour Automated WhatsApp Reminder
    // =========================================================================
    gateway.clear();
    const ref1h = new Date(new Date(clinicIso('2026-09-15T11:00:00.000Z')).getTime() - 60 * 60 * 1000);
    const reminders1Count = await reminders.send1HourReminders(ref1h);
    expect(reminders1Count).toBe(1);

    const reminder1hMsg = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(reminder1hMsg).toBeDefined();
    expect(reminder1hMsg?.body).toContain('in about 1 hour');

    // =========================================================================
    // STEP 9: Dr. Ziad completes visit & generates Invoice via Admin Dashboard
    // =========================================================================
    gateway.clear();
    const completeRes = await request(app)
      .post(`/admin/api/appointments/${appt.id}/complete`)
      .set('Authorization', `Bearer ${ADMIN_SECRET}`);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.success).toBe(true);

    const invoice = completeRes.body.invoice;
    expect(invoice.amount).toBe(120); // General Consultation in-office

    // Verify WhatsApp invoice received by patient
    const patientInvoiceMsg = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientInvoiceMsg).toBeDefined();
    expect(patientInvoiceMsg?.body).toContain('INVOICE / RECEIPT');
    expect(patientInvoiceMsg?.body).toContain('$120.00 USD');

    // =========================================================================
    // STEP 10: Patient pays & Doctor marks invoice paid -> WhatsApp Receipt
    // =========================================================================
    gateway.clear();
    const payRes = await request(app)
      .post(`/admin/api/invoices/${invoice.id}/pay`)
      .set('Authorization', `Bearer ${ADMIN_SECRET}`);
    expect(payRes.status).toBe(200);
    expect(payRes.body.invoice.status).toBe('paid');

    const receiptMsg = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(receiptMsg).toBeDefined();
    expect(receiptMsg?.body).toContain('PAYMENT CONFIRMATION');
    expect(receiptMsg?.body).toContain('$120.00');

    // =========================================================================
    // STEP 11: Audit log & message history inspection
    // =========================================================================
    const finalConvo = db.conversations.findActiveByCustomerId(cust.id)!;
    const messages = db.messages.getRecentMessages(finalConvo.id, 50);
    expect(messages.length).toBeGreaterThanOrEqual(4);

    const invoiceRecord = db.invoices.findByAppointmentId(appt.id);
    expect(invoiceRecord).toBeDefined();
    expect(invoiceRecord?.status).toBe('paid');
  });
});
