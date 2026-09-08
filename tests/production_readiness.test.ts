import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { AdminNotificationService } from '../src/notifications/admin.notifier.js';
import { AgentCore, MockGeminiClient } from '../src/gemini/index.js';
import { ReminderRunner } from '../src/reminders/runner.js';
import { BillingService } from '../src/billing/service.js';
import { createWebhookRouter } from '../src/twilio/webhook.js';

describe('🛡️ PRODUCTION READINESS & ARCHITECTURAL INTEGRITY SUITE', () => {
  let db: DatabaseContext;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;
  let gateway: MockWhatsAppGateway;
  let notifier: AdminNotificationService;
  let geminiClient: MockGeminiClient;
  let agent: AgentCore;
  let reminders: ReminderRunner;
  let billing: BillingService;
  let app: express.Application;
  const AUTH_TOKEN = 'secret_twilio_token_12345';

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    calendar = new InMemoryCalendarProvider();
    scheduler = new SchedulingEngine({ db, calendar, homeVisitBufferMinutes: 30 });
    gateway = new MockWhatsAppGateway();
    notifier = new AdminNotificationService({
      gateway,
      adminWhatsappNumber: 'whatsapp:+96170000001',
      alerts: db.alerts,
    });
    geminiClient = new MockGeminiClient();
    agent = new AgentCore({
      client: geminiClient,
      scheduler,
      notifier,
    });
    reminders = new ReminderRunner({ db, gateway });
    billing = new BillingService({ db, gateway });

    app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    const webhookRouter = createWebhookRouter({
      db,
      gateway,
      authToken: AUTH_TOKEN,
      skipSignatureVerification: false,
      processMessage: async ({ customer, conversation, incomingText }) => {
        const confirmReply = reminders.handleConfirmationResponse(customer.id, incomingText);
        if (confirmReply) return confirmReply;
        return agent.processMessage({ customer, conversation, incomingText, db });
      },
    });

    app.post('/webhook/whatsapp', webhookRouter.handleInboundMessage);
  });

  function computeTwilioSignature(url: string, params: Record<string, string>, token: string): string {
    let data = url;
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      data += key + params[key];
    }
    return crypto.createHmac('sha1', token).update(data, 'utf-8').digest('base64');
  }

  // 1. Signature Security
  it('1. Rejects forged webhook requests and accepts cryptographically valid signatures', async () => {
    const url = 'http://127.0.0.1/webhook/whatsapp';
    const body = {
      From: 'whatsapp:+96170111222',
      Body: 'Hello Doctor',
      MessageSid: 'SM_TEST_SIG_01',
    };

    // Attempt with forged signature
    const forgedRes = await request(app)
      .post('/webhook/whatsapp')
      .set('Host', '127.0.0.1')
      .set('x-twilio-signature', 'forged_fake_signature==')
      .type('form')
      .send(body);

    expect(forgedRes.status).toBe(403);

    // Attempt with valid cryptographic HMAC-SHA1 signature
    const validSig = computeTwilioSignature(url, body, AUTH_TOKEN);
    const validRes = await request(app)
      .post('/webhook/whatsapp')
      .set('Host', '127.0.0.1')
      .set('x-twilio-signature', validSig)
      .type('form')
      .send(body);

    expect(validRes.status).toBe(200);
  });

  // 2. High Concurrency
  it('2. Handles 30 concurrent webhook requests across multiple patients without race condition corruptions', async () => {
    const requests = [];
    for (let i = 0; i < 30; i++) {
      const phone = 'whatsapp:+961700000' + (i % 5);
      const sid = 'SM_CONCURRENCY_' + i;
      const body = {
        From: phone,
        Body: 'Hello request ' + i,
        MessageSid: sid,
      };
      const sig = computeTwilioSignature('http://127.0.0.1/webhook/whatsapp', body, AUTH_TOKEN);

      requests.push(
        request(app)
          .post('/webhook/whatsapp')
          .set('Host', '127.0.0.1')
          .set('x-twilio-signature', sig)
          .type('form')
          .send(body)
      );
    }

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Verify all 30 messages were logged in database
    const allMsgs = db.appDb.db.prepare('SELECT COUNT(*) as count FROM messages').get() as any;
    expect(allMsgs.count).toBe(60); // 30 inbound + 30 outbound replies
  });

  // 3. Webhook Idempotency on Rapid Retries
  it('3. Enforces idempotency when Twilio retries the same MessageSid 5 times', async () => {
    const body = {
      From: 'whatsapp:+96170999888',
      Body: 'I want to book an appointment',
      MessageSid: 'SM_DUPLICATE_IDEMPOTENCY_TEST',
    };
    const sig = computeTwilioSignature('http://127.0.0.1/webhook/whatsapp', body, AUTH_TOKEN);

    // Fire 5 rapid requests with identical MessageSid
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        await request(app)
          .post('/webhook/whatsapp')
          .set('Host', '127.0.0.1')
          .set('x-twilio-signature', sig)
          .type('form')
          .send(body)
      );
    }

    for (const res of results) {
      expect(res.status).toBe(200);
    }

    // Only 1 outbound reply should have been sent to WhatsApp gateway
    const sentCount = gateway.sentMessages.filter(m => m.to === 'whatsapp:+96170999888').length;
    expect(sentCount).toBe(1);
  });

  // 4. Opt-Out Compliance
  it('4. Honors WhatsApp STOP opt-outs immediately and suppresses future automated messages', async () => {
    const custPhone = 'whatsapp:+96170333444';
    const stopBody = {
      From: custPhone,
      Body: 'STOP',
      MessageSid: 'SM_OPT_OUT_01',
    };
    const stopSig = computeTwilioSignature('http://127.0.0.1/webhook/whatsapp', stopBody, AUTH_TOKEN);

    await request(app)
      .post('/webhook/whatsapp')
      .set('Host', '127.0.0.1')
      .set('x-twilio-signature', stopSig)
      .type('form')
      .send(stopBody);

    const customer = db.customers.findByPhone(custPhone);
    expect(Boolean(customer?.opted_out)).toBe(true);

    // Attempt sending a 24h reminder
    const now = new Date('2026-09-14T10:00:00.000Z');
    const apptTime = new Date('2026-09-15T10:00:00.000Z');
    db.appointments.create({
      customer_id: customer!.id,
      start_time: apptTime.toISOString(),
      end_time: new Date(apptTime.getTime() + 3600000).toISOString(),
      visit_type: 'in_office',
      service: 'General Consultation',
      status: 'booked',
    });

    const reminderCount = await reminders.send24HourReminders(now);
    expect(reminderCount).toBe(0); // Suppressed due to opt-out!
  });

  // 5. Complete Financial Ledger Consistency
  it('5. Maintains 100% financial consistency across completed visits and invoices', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+96170555777', 'Financial Patient');
    const appt = db.appointments.create({
      customer_id: cust.id,
      start_time: '2026-09-14T15:00:00.000Z',
      end_time: '2026-09-14T16:00:00.000Z',
      visit_type: 'in_office',
      service: 'Acupuncture / Therapy',
      price: 130,
      status: 'completed',
    });

    const invoice = await billing.createInvoiceForAppointment(appt.id);
    expect(invoice.amount).toBe(130);
    expect(invoice.status).toBe('unpaid');

    // Idempotent invoice check: second call returns same invoice without duplicating
    const invoice2 = await billing.createInvoiceForAppointment(appt.id);
    expect(invoice2.id).toBe(invoice.id);

    const paidInvoice = await billing.markInvoicePaid(invoice.id);
    expect(paidInvoice.status).toBe('paid');
    expect(paidInvoice.paid_at).toBeDefined();
  });
});
