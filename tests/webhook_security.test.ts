import { it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDatabaseContext } from '../src/db/index.js';
import { createWebhookRouter } from '../src/twilio/webhook.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';

function app(token?: string) {
  const db = createDatabaseContext(':memory:');
  const router = createWebhookRouter({ db, gateway: new MockWhatsAppGateway(), authToken: token, skipSignatureVerification: false });
  const app = express(); app.use(express.urlencoded({ extended: false }));
  app.post('/in', router.handleInboundMessage); app.post('/status', router.handleStatusCallback);
  return app;
}
it('fails closed when signature verification has no token', async () => {
  expect((await request(app()).post('/in').type('form').send({From:'whatsapp:+96171000111',Body:'Hello',MessageSid:'SM1'})).status).toBe(403);
});
it('rejects unsigned delivery callbacks', async () => {
  expect((await request(app('secret')).post('/status').type('form').send({ MessageSid:'SM1',MessageStatus:'failed' })).status).toBe(403);
});
