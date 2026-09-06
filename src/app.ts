import express from 'express';
import { DatabaseContext, createDatabaseContext } from './db/index.js';
import { CalendarProvider, InMemoryCalendarProvider, GoogleCalendarProvider } from './calendar/provider.js';
import { SchedulingEngine } from './calendar/scheduler.js';
import { WhatsAppGateway, MockWhatsAppGateway, TwilioWhatsAppGateway } from './twilio/client.js';
import { createWebhookRouter } from './twilio/webhook.js';
import { AdminNotificationService } from './notifications/admin.notifier.js';
import { AgentCore, GeminiClient, MockGeminiClient, LiveGeminiClient } from './gemini/index.js';
import { ReminderRunner } from './reminders/runner.js';
import { BillingService } from './billing/service.js';
import { createAdminRouter } from './admin/routes.js';
import { AppConfig, config as defaultAppConfig } from './config/index.js';

export interface AppInstance {
  app: express.Application;
  db: DatabaseContext;
  gateway: WhatsAppGateway;
  calendar: CalendarProvider;
  scheduler: SchedulingEngine;
  agent: AgentCore;
  reminders: ReminderRunner;
  billing: BillingService;
  notifier: AdminNotificationService;
}

export interface CreateAppOptions {
  config?: AppConfig;
  db?: DatabaseContext;
  calendar?: CalendarProvider;
  gateway?: WhatsAppGateway;
  geminiClient?: GeminiClient;
  skipSignatureVerification?: boolean;
}

export function createApp(options: CreateAppOptions = {}): AppInstance {
  const cfg = options.config || defaultAppConfig;

  // 1. Database
  const db = options.db || createDatabaseContext(cfg.databaseUrl);

  // 2. Gateway
  const gateway = options.gateway || (
    cfg.twilioAccountSid && cfg.twilioAuthToken
      ? new TwilioWhatsAppGateway(cfg.twilioAccountSid, cfg.twilioAuthToken, cfg.twilioWhatsappNumber || '', db.alerts)
      : new MockWhatsAppGateway()
  );

  // 3. Calendar
  const calendar = options.calendar || (
    cfg.googleCalendarClientId && cfg.googleCalendarClientSecret
      ? new GoogleCalendarProvider({
          clientId: cfg.googleCalendarClientId,
          clientSecret: cfg.googleCalendarClientSecret,
          calendarId: cfg.googleCalendarId || 'primary',
        })
      : new InMemoryCalendarProvider()
  );

  // 4. Scheduling Engine
  const scheduler = new SchedulingEngine({
    db,
    calendar,
    homeVisitBufferMinutes: cfg.homeVisitBufferMinutes,
  });

  // 5. Admin Notifier
  const notifier = new AdminNotificationService({
    gateway,
    adminWhatsappNumber: cfg.adminWhatsappNumber,
    alerts: db.alerts,
  });

  // 6. Gemini Agent
  const geminiClient = options.geminiClient || (
    cfg.geminiApiKey
      ? new LiveGeminiClient(cfg.geminiApiKey)
      : new MockGeminiClient()
  );

  const agent = new AgentCore({
    client: geminiClient,
    scheduler,
    notifier,
  });

  // 7. Reminders & Billing
  const reminders = new ReminderRunner({ db, gateway });
  const billing = new BillingService({ db, gateway });

  // 8. Express App
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Twilio Webhooks
  const webhookRouter = createWebhookRouter({
    db,
    gateway,
    authToken: cfg.twilioAuthToken,
    skipSignatureVerification: options.skipSignatureVerification ?? (cfg.nodeEnv !== 'production'),
    processMessage: async ({ customer, conversation, incomingText }) => {
      // Check if this incoming message is an interactive reminder confirmation (e.g. YES to confirm)
      const confirmationReply = reminders.handleConfirmationResponse(customer.id, incomingText);
      if (confirmationReply) {
        return confirmationReply;
      }
      return agent.processMessage({ customer, conversation, incomingText, db });
    },
  });

  app.post('/api/webhook/whatsapp', webhookRouter.handleInboundMessage);
  app.post('/api/webhook/whatsapp/status', webhookRouter.handleStatusCallback);

  // Admin Dashboard & API
  const adminRouter = createAdminRouter({
    db,
    billing,
    adminSecret: cfg.adminSessionSecret,
  });
  app.use('/admin', adminRouter);

  return {
    app,
    db,
    gateway,
    calendar,
    scheduler,
    agent,
    reminders,
    billing,
    notifier,
  };
}
