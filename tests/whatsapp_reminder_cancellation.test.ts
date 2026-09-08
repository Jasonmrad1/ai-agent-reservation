import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/agent.js';

describe('📅 24-HOUR REMINDERS & DIRECT WHATSAPP CANCELLATION SUITE', () => {
  let appInstance: AppInstance;
  let gateway: MockWhatsAppGateway;
  let calendar: InMemoryCalendarProvider;
  let geminiClient: MockGeminiClient;

  const ADMIN_SECRET = 'dr_ziad_secret_2026';
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';
  const DOCTOR_PHONE = 'whatsapp:+96171476193';
  const PATIENT_PHONE = 'whatsapp:+96170666777';
  const PATIENT_NAME = 'Nour Khoury';

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

  it('sends 24-hour reminder with interactive choices and cancels appointment when patient replies CANCEL', async () => {
    const { app, db, reminders } = appInstance;

    // 1. Create patient and upcoming appointment
    const cust = db.customers.findOrCreate(PATIENT_PHONE, PATIENT_NAME);
    const calEventId = await calendar.createEvent({
      summary: 'General Consultation - Nour Khoury',
      start: new Date('2026-09-14T10:00:00.000Z'),
      end: new Date('2026-09-14T11:00:00.000Z'),
    });

    const appt = db.appointments.create({
      customer_id: cust.id,
      visit_type: 'in_office',
      service: 'General Consultation',
      price: 120,
      start_time: '2026-09-14T10:00:00.000Z',
      end_time: '2026-09-14T11:00:00.000Z',
      google_event_id: calEventId,
    });

    // 2. Trigger 24-Hour Reminder job
    const baseNow = new Date('2026-09-13T10:00:00.000Z');
    const sentCount = await reminders.send24HourReminders(baseNow);
    expect(sentCount).toBe(1);

    // Verify reminder content
    const reminderMsg = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(reminderMsg).toBeDefined();
    expect(reminderMsg?.body).toContain('Dr. Ziad El Khoury');
    expect(reminderMsg?.body).toContain('*YES* to confirm');
    expect(reminderMsg?.body).toContain('*RESCHEDULE*');
    expect(reminderMsg?.body).toContain('*CANCEL*');

    // 3. Patient replies "CANCEL" via WhatsApp
    gateway.clear();
    const cancelRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'CANCEL',
        MessageSid: 'SM_PATIENT_CANCEL_REMINDER_01',
      });

    expect(cancelRes.status).toBe(200);

    // Verify patient received cancellation acknowledgment
    const patientReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientReply).toBeDefined();
    expect(patientReply?.body).toContain('cancelled');
    expect(patientReply?.body).toContain('General Consultation');

    // Verify Doctor received WhatsApp cancellation alert
    const doctorAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(doctorAlert).toBeDefined();
    expect(doctorAlert?.body).toContain('APPOINTMENT CANCELLED');
    expect(doctorAlert?.body).toContain(PATIENT_NAME);

    // Verify Appointment status is cancelled in DB
    const updatedAppt = db.appointments.findById(appt.id);
    expect(updatedAppt?.status).toBe('cancelled');

    // Verify Google Calendar event was deleted
    const calEvents = await calendar.listEvents(
      new Date('2026-09-14T09:00:00.000Z'),
      new Date('2026-09-14T12:00:00.000Z')
    );
    expect(calEvents.length).toBe(0);
  });

  it('handles RESCHEDULE and YES replies seamlessly', async () => {
    const { app, db, reminders } = appInstance;

    const cust = db.customers.findOrCreate(PATIENT_PHONE, PATIENT_NAME);
    const appt = db.appointments.create({
      customer_id: cust.id,
      visit_type: 'in_office',
      service: 'Follow-up Consultation',
      price: 70,
      start_time: '2026-09-14T14:00:00.000Z',
      end_time: '2026-09-14T15:00:00.000Z',
    });

    // Patient replies "RESCHEDULE"
    const reschedRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'RESCHEDULE',
        MessageSid: 'SM_RESCHED_INQUIRY',
      });

    expect(reschedRes.status).toBe(200);
    const reschedReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(reschedReply?.body).toContain('What new day and time');

    // Patient replies "YES"
    gateway.clear();
    const confirmRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'YES',
        MessageSid: 'SM_YES_CONFIRM',
      });

    expect(confirmRes.status).toBe(200);
    const confirmedAppt = db.appointments.findById(appt.id);
    expect(confirmedAppt?.status).toBe('confirmed');
  });
});
