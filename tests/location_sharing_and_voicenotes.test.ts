import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/agent.js';

describe('📍 WHATSAPP LOCATION SHARING & 🎙️ VOICE NOTE HANDLING SUITE', () => {
  let appInstance: AppInstance;
  let gateway: MockWhatsAppGateway;
  let calendar: InMemoryCalendarProvider;
  let geminiClient: MockGeminiClient;

  const ADMIN_SECRET = 'dr_ziad_secret_2026';
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';
  const DOCTOR_PHONE = 'whatsapp:+96171476193';
  const PATIENT_PHONE = 'whatsapp:+96170888999';
  const PATIENT_NAME = 'Michel Haddad';

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

  it('accepts and extracts WhatsApp location pin (GPS coordinates & Maps link) for home visit booking', async () => {
    const { app, db } = appInstance;

    // Patient shares WhatsApp Location pin for home visit
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-16',
        time: '14:00',
        visit_type: 'home_visit',
        service: 'Home Visit Care',
        address: '📍 Shared Location: Sassine Square, Achrafieh (GPS: 33.8938, 35.5018) | Maps: https://maps.google.com/?q=33.8938,35.5018',
        customer_name: PATIENT_NAME,
      },
    };

    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Please book a home visit for Wednesday at 2:00 PM here is my location',
        Latitude: '33.8938',
        Longitude: '35.5018',
        Address: 'Sassine Square, Achrafieh, Beirut',
        Label: 'Michel Residence',
        MessageSid: 'SM_LOC_01',
        ProfileName: PATIENT_NAME,
      });

    expect(res.status).toBe(200);

    // 1. Patient received booking confirmation
    const patientReply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(patientReply).toBeDefined();
    expect(patientReply?.body).toContain('confirmed');

    // 2. Doctor received WhatsApp notification with the GPS coordinates and Google Maps link
    const doctorAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(doctorAlert).toBeDefined();
    expect(doctorAlert?.body).toContain('Home Visit');
    expect(doctorAlert?.body).toContain('33.8938');
    expect(doctorAlert?.body).toContain('maps.google.com');

    // 3. Appointment in DB stores the exact GPS location
    const appts = db.appointments.listUpcoming(10);
    expect(appts.length).toBe(1);
    expect(appts[0].visit_type).toBe('home_visit');
    expect(appts[0].address).toContain('33.8938');
  });

  it('detects incoming WhatsApp voice note and replies with guidance to text or connect with human', async () => {
    const { app } = appInstance;

    // Patient sends an audio/ogg voice note without typed body text
    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        NumMedia: '1',
        MediaContentType0: 'audio/ogg',
        MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages/MMyyy/Media/MEzzz',
        MessageSid: 'SM_VOICE_01',
        ProfileName: PATIENT_NAME,
      });

    expect(res.status).toBe(200);

    const reply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(reply).toBeDefined();
    expect(reply?.body).toMatch(/voice note|written messages|type your appointment request|human/i);
  });
});
