import { clinicIso } from './clinic-time.js';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient, detectLanguage, formatEnglishDate, formatLebDate } from '../src/gemini/agent.js';

describe('🌐 MULTILINGUAL (ENGLISH & ARABIZI) SMOOTH & FLAWLESS REPLIES SUITE', () => {
  let appInstance: AppInstance;
  let gateway: MockWhatsAppGateway;
  let calendar: InMemoryCalendarProvider;
  let geminiClient: MockGeminiClient;

  const ADMIN_SECRET = 'dr_ziad_secret_2026';
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';
  const DOCTOR_PHONE = 'whatsapp:+96171476193';
  const ENGLISH_PATIENT_PHONE = 'whatsapp:+14150009999';
  const ARABIZI_PATIENT_PHONE = 'whatsapp:+96170111222';

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

  it('correctly detects language dialects across English, Arabizi, French, and Arabic', () => {
    expect(detectLanguage('Hello, I would like to book an appointment with Dr. Ziad')).toBe('english');
    expect(detectLanguage('What are the available slots next Monday?')).toBe('english');
    expect(detectLanguage('Can I book for tomorrow at 2pm?')).toBe('english');
    expect(detectLanguage('See you at 3pm on the 2nd floor')).toBe('english');
    expect(detectLanguage('Bde maw3ad bkra tnen se3a 10 kermel dahre')).toBe('arabizi');
    expect(detectLanguage('Ahla hakim, kifak l yom?')).toBe('arabizi');
    expect(detectLanguage('Bonjour docteur, est-ce possible de prendre un rendez-vous?')).toBe('french');
    expect(detectLanguage('مرحبا دكتور، بدي موعد بكرا بعيادتك')).toBe('arabic');
  });

  it('formats dates cleanly in English without raw ISO strings or timezone tokens', () => {
    const iso = clinicIso('2026-09-14T10:00:00.000Z');
    const formattedEng = formatEnglishDate(iso);
    expect(formattedEng).toContain('Monday');
    expect(formattedEng).toContain('Sep 14');
    expect(formattedEng).toContain('10:00 AM');
    expect(formattedEng).not.toContain('T');
    expect(formattedEng).not.toContain('.000Z');

    const formattedLeb = formatLebDate(iso);
    expect(formattedLeb).toContain('Tnen');
    expect(formattedLeb).toContain('Ayloul');
    expect(formattedLeb).toContain('10:00 AM');
  });

  it('handles smooth, empathetic English booking inquiry and confirmation', async () => {
    const { app, db } = appInstance;

    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '10:00',
        visit_type: 'in_office',
        service: 'General Consultation',
        customer_name: 'Emily Davis',
      },
    };

    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: ENGLISH_PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Hello Dr. Ziad, I have severe back pain and would like to book a consultation for Monday at 10:00 AM.',
        MessageSid: 'SM_ENG_BOOK_01',
        ProfileName: 'Emily Davis',
      });

    expect(res.status).toBe(200);
    expect(gateway.sentMessages.length).toBeGreaterThanOrEqual(1);

    const patientReply = gateway.sentMessages.find((m) => m.to === ENGLISH_PATIENT_PHONE);
    expect(patientReply).toBeDefined();
    expect(patientReply?.body).toContain('confirmed');

    // Doctor alert received on admin phone
    const doctorAlert = gateway.sentMessages.find((m) => m.to === DOCTOR_PHONE);
    expect(doctorAlert).toBeDefined();
    expect(doctorAlert?.body).toContain('Emily Davis');
  });

  it('provides polished English availability check and decisive follow-up booking', async () => {
    const { app } = appInstance;

    // Step 1: Check availability in English
    geminiClient.mockToolCall = {
      name: 'check_availability',
      args: {
        date: '2026-09-15',
        visit_type: 'home_visit',
      },
    };

    const availRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: ENGLISH_PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Hi! Could you please let me know what times are open for a home visit next Tuesday?',
        MessageSid: 'SM_ENG_AVAIL_01',
        ProfileName: 'Emily Davis',
      });

    expect(availRes.status).toBe(200);
    const availReply = gateway.sentMessages.find((m) => m.to === ENGLISH_PATIENT_PHONE);
    expect(availReply).toBeDefined();
    expect(availReply?.body).toContain('2026-09-15');

    // Step 2: Patient confirms choice with address
    gateway.clear();
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-15',
        time: '14:00',
        visit_type: 'home_visit',
        service: 'Home Visit Care',
        address: '742 Evergreen Terrace',
        customer_name: 'Emily Davis',
      },
    };

    const bookRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: ENGLISH_PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: '2:00 PM works great. My address is 742 Evergreen Terrace.',
        MessageSid: 'SM_ENG_BOOK_02',
      });

    expect(bookRes.status).toBe(200);
    const confirmReply = gateway.sentMessages.find((m) => m.to === ENGLISH_PATIENT_PHONE);
    expect(confirmReply).toBeDefined();
    expect(confirmReply?.body).toContain('confirmed');
  });

  it('handles English reschedule and cancellation requests with high empathy', async () => {
    const { app, db } = appInstance;

    // First book an appointment to reschedule
    const cust = db.customers.findOrCreate(ENGLISH_PATIENT_PHONE, 'Emily Davis');
    const appt = db.appointments.create({
      customer_id: cust.id,
      service: 'General Consultation',
      price: 120,
      start_time: clinicIso('2026-09-14T10:00:00.000Z'),
      end_time: clinicIso('2026-09-14T11:00:00.000Z'),
      visit_type: 'in_office',
    });

    // Reschedule in English
    geminiClient.mockToolCall = {
      name: 'reschedule_appointment',
      args: {
        appointment_id: appt.id,
        new_date: '2026-09-16',
        new_time: '11:00',
      },
    };

    const reschedRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: ENGLISH_PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Could you please move my appointment to Wednesday at 11:00 AM?',
        MessageSid: 'SM_ENG_RESCHED_01',
      });

    expect(reschedRes.status).toBe(200);
    const reschedReply = gateway.sentMessages.find((m) => m.to === ENGLISH_PATIENT_PHONE);
    expect(reschedReply?.body).toContain('rescheduled');

    // Cancellation in English
    gateway.clear();
    geminiClient.mockToolCall = {
      name: 'cancel_appointment',
      args: {
        reason: 'Patient recovered',
      },
    };

    const cancelRes = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: ENGLISH_PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Please cancel my appointment, I am feeling much better now.',
        MessageSid: 'SM_ENG_CANCEL_01',
      });

    expect(cancelRes.status).toBe(200);
    const cancelReply = gateway.sentMessages.find((m) => m.to === ENGLISH_PATIENT_PHONE);
    expect(cancelReply?.body).toContain('cancelled');
  });

  it('handles French patient inquiries and replies in pure, elegant French without Arabic bias', async () => {
    const { app } = appInstance;
    const FRENCH_PATIENT_PHONE = 'whatsapp:+33612345678';

    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-15',
        time: '11:00',
        visit_type: 'in_office',
        service: 'General Consultation',
        customer_name: 'Jean-Pierre Dubois',
      },
    };

    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: FRENCH_PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Bonjour docteur, je voudrais prendre un rendez-vous pour une consultation mardi à 11h svp.',
        MessageSid: 'SM_FR_BOOK_01',
        ProfileName: 'Jean-Pierre Dubois',
      });

    expect(res.status).toBe(200);
    const reply = gateway.sentMessages.find((m) => m.to === FRENCH_PATIENT_PHONE);
    expect(reply).toBeDefined();
    expect(reply?.body).toMatch(/rendez-vous|confirmé|Parfait/i);
    // Must NOT contain Arabizi words
    expect(reply?.body).not.toMatch(/ahla|marhaba|tekram|salemeh/i);
  });
});
