import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/agent.js';

describe('👨‍⚕️ HUMAN HANDOFF & WHATSAPP BUSINESS DIRECT LINK SUITE', () => {
  let appInstance: AppInstance;
  let gateway: MockWhatsAppGateway;
  let calendar: InMemoryCalendarProvider;
  let geminiClient: MockGeminiClient;

  const ADMIN_SECRET = 'dr_ziad_secret_2026';
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';
  const DOCTOR_PHONE = 'whatsapp:+96171476193';
  const PATIENT_PHONE = 'whatsapp:+96170555666';
  const PATIENT_NAME = 'Georges Sarkis';

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

  it('sends Dr. Ziad a one-click WhatsApp Business link when a patient requests a human', async () => {
    const { app, db } = appInstance;

    // Step 1: Patient asks to speak to the doctor directly
    geminiClient.mockToolCall = {
      name: 'escalate_to_human',
      args: {
        reason: 'Patient specifically requested to talk with Dr. Ziad directly',
        urgency: 'medium',
      },
    };

    const reqRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Hello, I have a specific question about my surgery results and would like to talk directly with Dr. Ziad please.',
        MessageSid: 'SM_HANDOFF_01',
        ProfileName: PATIENT_NAME,
      });

    expect(reqRes.status).toBe(200);

    // 1. Patient received polite escalation acknowledgment
    const patientReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientReply).toBeDefined();
    expect(patientReply?.body).toMatch(/connected|informed|staff|team/i);

    // 2. Doctor (Admin) received high-priority WhatsApp notification containing direct WhatsApp Business link
    const doctorAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(doctorAlert).toBeDefined();
    expect(doctorAlert?.body).toContain('HUMAN HANDOFF REQUESTED');
    expect(doctorAlert?.body).toContain(PATIENT_NAME);
    expect(doctorAlert?.body).toContain('https://wa.me/96170555666'); // Direct 1-tap link to WhatsApp Business

    // 3. Conversation is now in 'escalated' mode
    const cust = db.customers.findByPhone(PATIENT_PHONE)!;
    const conv = db.conversations.findActiveByCustomerId(cust.id)!;
    expect(conv.status).toBe('escalated');

    // 4. Patient sends follow-up casual text -> AI yields and stays silent
    gateway.clear();
    const followUpRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Thank you, I will wait for Dr. Ziad to message me.',
        MessageSid: 'SM_HANDOFF_02',
      });

    expect(followUpRes.status).toBe(200);
    expect(gateway.sentMessages.length).toBe(0); // Bot did not interfere

    // 5. Dr. Ziad opens WhatsApp Business and texts patient -> conversation transitions to doctor_active
    const drDirectReplyRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: CLINIC_WHATSAPP,
        To: PATIENT_PHONE,
        Body: 'Bonjour Georges, Dr. Ziad here. I reviewed your surgery results and everything looks excellent.',
        MessageSid: 'SM_DR_REPLY_01',
      });

    expect(drDirectReplyRes.status).toBe(200);
    const updatedConv = db.conversations.findActiveByCustomerId(cust.id)!;
    expect(updatedConv.status).toBe('doctor_active');

    await request(app).post('/api/webhook/whatsapp').send({From:PATIENT_PHONE,Body:'/resume bot',MessageSid:'SM_EXPLICIT_RESUME'});
    gateway.clear();

    // 6. Patient asks to book a follow-up -> AI smoothly re-engages and completes booking
    gateway.clear();
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '11:00',
        visit_type: 'in_office',
        service: 'Follow-up Consultation',
        customer_name: PATIENT_NAME,
      },
    };

    const bookRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Great news! Please book me for a follow-up consultation on Monday at 11:00 AM.',
        MessageSid: 'SM_PATIENT_REBOOK_01',
      });

    expect(bookRes.status).toBe(200);
    const bookingConfirm = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(bookingConfirm).toBeDefined();
    expect(bookingConfirm?.body).toContain('confirmed');
  });

  it('never reveals doctor personal number to patient and alerts admin number of request', async () => {
    const { app, db } = appInstance;

    // Patient explicitly asks for personal phone number
    const reqRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: "Can you send me Dr. Ziad's personal phone number or mobile to call him directly?",
        MessageSid: 'SM_PRIVACY_01',
        ProfileName: PATIENT_NAME,
      });

    expect(reqRes.status).toBe(200);

    // 1. Patient received polite reassurance WITHOUT any personal phone numbers
    const patientReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientReply).toBeDefined();
    // Must NOT contain doctor's phone number
    expect(patientReply?.body).not.toContain('71476193');
    expect(patientReply?.body).not.toContain('+961');
    expect(patientReply?.body).toMatch(/informed|notified|Dr\. Ziad|clinic team|message you directly/i);

    // 2. Doctor (Admin number) received the notification of customer requesting contact
    const doctorAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(doctorAlert).toBeDefined();
    expect(doctorAlert?.body).toContain('HUMAN HANDOFF REQUESTED');
    expect(doctorAlert?.body).toContain(PATIENT_NAME);
    expect(doctorAlert?.body).toContain('https://wa.me/96170555666');
  });

  it('handles Arabizi phone request gracefully and alerts admin number', async () => {
    const { app } = appInstance;

    const reqRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'A3tini ra2em l hakim el personal bedde e7ke ma3 l hakim',
        MessageSid: 'SM_PRIVACY_ARABIZI_01',
        ProfileName: PATIENT_NAME,
      });

    expect(reqRes.status).toBe(200);

    const patientReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientReply).toBeDefined();
    expect(patientReply?.body).not.toContain('71476193');
    expect(patientReply?.body).toContain('5abbarit Dr. Ziad');

    const doctorAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(doctorAlert).toBeDefined();
    expect(doctorAlert?.body).toContain('https://wa.me/96170555666');
  });
});
