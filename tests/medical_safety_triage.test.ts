import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/agent.js';

describe('🚑 MEDICAL SAFETY & EMERGENCY TRIAGE PROTOCOL', () => {
  let appInstance: AppInstance;
  let gateway: MockWhatsAppGateway;
  let calendar: InMemoryCalendarProvider;
  let geminiClient: MockGeminiClient;

  const ADMIN_SECRET = 'dr_ziad_secret_2026';
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';
  const DOCTOR_PHONE = 'whatsapp:+96171476193';
  const PATIENT_PHONE = 'whatsapp:+14159990000';

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

  it('immediately triggers emergency escalation and 112/ER advisory on acute chest pain in English', async () => {
    const { app, db } = appInstance;

    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Help, I am having sudden severe chest pain and shortness of breath!',
        MessageSid: 'SM_EMERGENCY_01',
        ProfileName: 'John Doe',
      });

    expect(res.status).toBe(200);

    // Verify patient reply contains critical 112 / Emergency Room advisory
    const patientReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientReply).toBeDefined();
    expect(patientReply?.body).toContain('112');
    expect(patientReply?.body).toContain('emergency');

    // Verify Doctor / Admin received high-priority alert
    const doctorAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(doctorAlert).toBeDefined();
    expect(doctorAlert?.body).toContain('Urgency: HIGH');

    // Verify DB alert created
    const alerts = db.alerts.listPending();
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('human_handoff');
  });

  it('triggers Lebanese Arabizi emergency advisory when patient reports waja3 bi sadre or dii2et nafas', async () => {
    const { app, db } = appInstance;

    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: 'whatsapp:+96170444333',
        To: CLINIC_WHATSAPP,
        Body: 'Hakim bde mse3adeh 3am 7ess bi waja3 bi sadre w dii2et nafas ktir!',
        MessageSid: 'SM_EMERGENCY_02',
        ProfileName: 'Fadi',
      });

    expect(res.status).toBe(200);

    const patientReply = gateway.sentMessages.find((m) => m.to === 'whatsapp:+96170444333');
    expect(patientReply).toBeDefined();
    expect(patientReply?.body).toContain('112');
  });

  it('does NOT trigger emergency on standard non-acute inquiries like back pain or follow-ups', async () => {
    const { app } = appInstance;

    geminiClient.mockToolCall = {
      name: 'check_availability',
      args: { date: '2026-09-14', visit_type: 'in_office' },
    };

    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Hello, I have some mild back stiffness from sitting at work and would like to book a routine checkup next week.',
        MessageSid: 'SM_ROUTINE_01',
      });

    expect(res.status).toBe(200);

    const patientReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientReply?.body).not.toContain('112');
    expect(patientReply?.body).toContain('2026-09-14');
  });
});
