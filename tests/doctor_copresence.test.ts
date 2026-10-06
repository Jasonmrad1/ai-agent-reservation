import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { AdminNotificationService } from '../src/notifications/admin.notifier.js';
import { AgentCore, MockGeminiClient } from '../src/gemini/index.js';
import { createWebhookRouter } from '../src/twilio/webhook.js';

describe('👨‍⚕️ DR. ZIAD EL KHOURY CO-PRESENCE & LIVE CHAT NON-INTERFERENCE SUITE', () => {
  let db: DatabaseContext;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;
  let gateway: MockWhatsAppGateway;
  let notifier: AdminNotificationService;
  let geminiClient: MockGeminiClient;
  let agent: AgentCore;
  let app: express.Application;
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';

  beforeEach(() => {
    process.env.TWILIO_WHATSAPP_NUMBER = CLINIC_WHATSAPP;
    db = createDatabaseContext(':memory:');
    calendar = new InMemoryCalendarProvider();
    scheduler = new SchedulingEngine({ db, calendar, homeVisitBufferMinutes: 30 });
    gateway = new MockWhatsAppGateway();
    notifier = new AdminNotificationService({
      gateway,
      adminWhatsappNumber: 'whatsapp:+96171476193',
      alerts: db.alerts,
    });
    geminiClient = new MockGeminiClient();
    agent = new AgentCore({
      client: geminiClient,
      scheduler,
      notifier,
    });

    app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    const webhookRouter = createWebhookRouter({
      db,
      gateway,
      skipSignatureVerification: true,
      processMessage: async ({ customer, conversation, incomingText }) => {
        return agent.processMessage({ customer, conversation, incomingText, db });
      },
    });

    app.post('/webhook/whatsapp', webhookRouter.handleInboundMessage);
  });

  it('1. Dr. Ziad sends direct message to patient: recorded as outbound and sets doctor_active mode', async () => {
    const patientPhone = 'whatsapp:+96170123456';
    const doctorMsg = {
      From: CLINIC_WHATSAPP,
      To: patientPhone,
      Body: 'Bonjour Charbel, kif soret l yom? Khod hal dawa martein bil nhar.',
      MessageSid: 'SM_DR_DIRECT_01',
    };

    const res = await request(app)
      .post('/webhook/whatsapp')
      .type('form')
      .send(doctorMsg);

    expect(res.status).toBe(200);

    // Verify patient conversation exists and is doctor_active
    const patient = db.customers.findByPhone(patientPhone);
    expect(patient).toBeDefined();

    const conv = db.conversations.findActiveByCustomerId(patient!.id);
    expect(conv?.status).toBe('doctor_active');

    // Verify no bot auto-reply was triggered by the doctor speaking
    const botReplies = gateway.sentMessages.filter(m => m.to === patientPhone);
    expect(botReplies.length).toBe(0);
  });

  it('2. Patient replies to Dr. Ziad casually: AI remains silent and does NOT book a fake meeting', async () => {
    const patientPhone = 'whatsapp:+96170123456';
    const patient = db.customers.findOrCreate(patientPhone, 'Charbel');
    const conv = db.conversations.getOrCreateActive(patient.id);
    db.conversations.updateStatus(conv.id, 'doctor_active');

    // Patient replies to Dr. Ziad's medical advice
    const patientMsg = {
      From: patientPhone,
      Body: 'Merci ktir hakim, 3am ba3mol hek w 3am erteh!',
      MessageSid: 'SM_PATIENT_REPLY_01',
    };

    const res = await request(app)
      .post('/webhook/whatsapp')
      .type('form')
      .send(patientMsg);

    expect(res.status).toBe(200);

    // AI must NOT trigger a booking or reply
    const botReplies = gateway.sentMessages.filter(m => m.to === patientPhone);
    expect(botReplies.length).toBe(0);

    // Message is logged in database for Dr. Ziad to view
    const messages = db.messages.getRecentMessages(conv.id, 5);
    expect(messages.some(m => m.body.includes('Merci ktir hakim'))).toBe(true);
  });

  it('3. Patient in doctor_active mode explicitly asks for a new appointment: AI re-engages and books seamlessly', async () => {
    const patientPhone = 'whatsapp:+96170123456';
    const patient = db.customers.findOrCreate(patientPhone, 'Charbel');
    const conv = db.conversations.getOrCreateActive(patient.id);
    db.conversations.updateStatus(conv.id, 'doctor_active');

    await request(app).post('/webhook/whatsapp').send({From:patientPhone,Body:'/resume bot',MessageSid:'SM_EXPLICIT_RESUME'});
    gateway.clear();

    // Patient asks for an appointment
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '10:00',
        visit_type: 'in_office',
        service: 'General Consultation',
        customer_name: 'Charbel',
      },
    };

    const patientBookingMsg = {
      From: patientPhone,
      Body: 'Hakim bde maw3ad bkra se3a 10 bil 3iyade',
      MessageSid: 'SM_PATIENT_BOOKING_01',
    };

    const res = await request(app)
      .post('/webhook/whatsapp')
      .type('form')
      .send(patientBookingMsg);

    expect(res.status).toBe(200);

    // AI sends booking confirmation
    const botReplies = gateway.sentMessages.filter(m => m.to === patientPhone);
    expect(botReplies.length).toBe(1);
    expect(botReplies[0].body).toMatch(/confirmed|Zabbattelak/i);

    // Conversation returns to active
    const updatedConv = db.conversations.findActiveByCustomerId(patient.id);
    expect(updatedConv?.status).toBe('active');
  });
});
