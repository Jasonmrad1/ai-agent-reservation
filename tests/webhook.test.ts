import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { createWebhookRouter } from '../src/twilio/webhook.js';
import { withRetry } from '../src/utils/retry.js';

describe('Phase 2: WhatsApp Webhook & Gateway Layer', () => {
  let db: DatabaseContext;
  let gateway: MockWhatsAppGateway;
  let app: express.Application;

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    gateway = new MockWhatsAppGateway();

    const router = createWebhookRouter({
      db,
      gateway,
      skipSignatureVerification: true,
      processMessage: async ({ incomingText }) => {
        return `Echo: ${incomingText}`;
      },
    });

    app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    app.post('/api/webhook/whatsapp', router.handleInboundMessage);
    app.post('/api/webhook/whatsapp/status', router.handleStatusCallback);
  });

  it('receives inbound message, logs customer and messages, sends reply', async () => {
    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: 'whatsapp:+1987654321',
        Body: 'Hello world',
        MessageSid: 'SM_TEST_001',
        ProfileName: 'John Doe',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('<Response/>');

    // Check DB
    const cust = db.customers.findByPhone('whatsapp:+1987654321');
    expect(cust).not.toBeNull();
    expect(cust?.name).toBe('John Doe');

    const conv = db.conversations.findActiveByCustomerId(cust!.id);
    expect(conv).not.toBeNull();

    const messages = db.messages.getRecentMessages(conv!.id);
    expect(messages.length).toBe(2);
    expect(messages[0].body).toBe('Hello world');
    expect(messages[0].direction).toBe('inbound');
    expect(messages[1].body).toBe('Echo: Hello world');
    expect(messages[1].direction).toBe('outbound');

    // Gateway check
    expect(gateway.sentMessages.length).toBe(1);
    expect(gateway.sentMessages[0].body).toBe('Echo: Hello world');
    expect(gateway.sentMessages[0].to).toBe('whatsapp:+1987654321');
  });

  it('enforces idempotency on duplicate MessageSid', async () => {
    // First delivery
    await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: 'whatsapp:+1987654321',
        Body: 'Hello once',
        MessageSid: 'SM_DUPLICATE_001',
      });

    expect(gateway.sentMessages.length).toBe(1);

    // Duplicate delivery from Twilio retry
    const res2 = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: 'whatsapp:+1987654321',
        Body: 'Hello once',
        MessageSid: 'SM_DUPLICATE_001',
      });

    expect(res2.status).toBe(200);
    expect(gateway.sentMessages.length).toBe(1); // No second send!
  });

  it('handles STOP opt-out and START opt-in', async () => {
    // 1. Send STOP
    await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: 'whatsapp:+1987654321',
        Body: 'STOP',
        MessageSid: 'SM_OPTOUT_001',
      });

    const cust = db.customers.findByPhone('whatsapp:+1987654321');
    expect(cust?.opted_out).toBe(true);
    expect(gateway.sentMessages.some((m) => m.body.includes('unsubscribed'))).toBe(true);

    gateway.clear();

    // 2. Next message from opted-out customer should not trigger normal replies
    await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: 'whatsapp:+1987654321',
        Body: 'Are you there?',
        MessageSid: 'SM_AFTER_OPTOUT',
      });

    expect(gateway.sentMessages.length).toBe(0);

    // 3. Send START to re-subscribe
    await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: 'whatsapp:+1987654321',
        Body: 'START',
        MessageSid: 'SM_OPTIN_001',
      });

    const resubscribed = db.customers.findByPhone('whatsapp:+1987654321');
    expect(resubscribed?.opted_out).toBe(false);
    expect(gateway.sentMessages.some((m) => m.body.includes('resubscribed'))).toBe(true);
  });

  it('updates message status on delivery callback and alerts on failure', async () => {
    // Create initial inbound message
    await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: 'whatsapp:+1987654321',
        Body: 'Booking test',
        MessageSid: 'SM_OUTBOUND_TEST',
      });

    const sentSid = gateway.sentMessages[0].messageSid;

    // Delivery successful status callback
    const resSuccess = await request(app)
      .post('/api/webhook/whatsapp/status')
      .send({
        MessageSid: sentSid,
        MessageStatus: 'delivered',
      });
    expect(resSuccess.status).toBe(200);

    const deliveredMsg = db.messages.findByMessageSid(sentSid);
    expect(deliveredMsg?.status).toBe('delivered');

    // Delivery failure status callback
    await request(app)
      .post('/api/webhook/whatsapp/status')
      .send({
        MessageSid: sentSid,
        MessageStatus: 'undelivered',
        ErrorCode: '30008',
      });

    const alerts = db.alerts.listPending();
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('delivery_failure');
    expect(alerts[0].details).toContain('30008');
  });

  it('tests retry utility with exponential backoff', async () => {
    let attempts = 0;
    const result = await withRetry(
      async (attempt) => {
        attempts = attempt;
        if (attempt < 3) {
          throw new Error('Temporary failure');
        }
        return 'success!';
      },
      {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffFactor: 1.5,
      }
    );

    expect(result).toBe('success!');
    expect(attempts).toBe(3);
  });
});
