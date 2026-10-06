import { DurableWhatsAppGateway } from './twilio/durable.js';
import {backupSqliteFile} from './db/backup.js';
import {readiness} from './readiness.js';
import fs from 'fs';
import { createAdminAuth } from './security/admin-auth.js';
import path from 'path';
import express from 'express';
import { DatabaseContext, createDatabaseContext } from './db/index.js';
import { getSupabaseClient } from './db/supabase.js';
import { ReplicaWorker } from './db/replication.js';
import { CalendarProvider, InMemoryCalendarProvider, GoogleCalendarProvider } from './calendar/provider.js';
import { SchedulingEngine } from './calendar/scheduler.js';
import { WhatsAppGateway, MockWhatsAppGateway, TwilioWhatsAppGateway } from './twilio/client.js';
import { createWebhookRouter } from './twilio/webhook.js';
import { AdminNotificationService } from './notifications/admin.notifier.js';
import { AgentCore, GeminiClient, MockGeminiClient, LiveGeminiClient } from './gemini/index.js';
import { ReminderRunner } from './reminders/runner.js';
import { BillingService } from './billing/service.js';
import { createAdminRouter } from './admin/routes.js';
import { createSimulatorRouter } from './simulator/router.js';
import { AppConfig, config as defaultAppConfig, validateConfig } from './config/index.js';

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
  replica: ReplicaWorker;
  outbox: DurableWhatsAppGateway;
  inbox: {drain():Promise<void>;recoverInterrupted():void};
  simulator: { db: DatabaseContext; gateway: MockWhatsAppGateway };
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
  validateConfig(cfg);
  if(cfg.nodeEnv==='production' && cfg.mode!=='simulator' && options.skipSignatureVerification)throw new Error('Production webhook signature verification cannot be disabled');

  // 1. Database
  if(!options.db && cfg.nodeEnv==='production' && cfg.databaseUrl!==':memory:' && fs.existsSync(cfg.databaseUrl)) backupSqliteFile(cfg.databaseUrl,path.join(path.dirname(cfg.databaseUrl),'backups'));
  const db = options.db || createDatabaseContext(cfg.databaseUrl,{encryptionKey:cfg.settingsEncryptionKey});
  const replica = new ReplicaWorker(db,getSupabaseClient(cfg),cfg.supabaseUrl);

  // 2. Gateway
  const rawGateway = options.gateway || (
    cfg.mode !== 'simulator' && cfg.twilioAccountSid && cfg.twilioAuthToken
      ? new TwilioWhatsAppGateway(
          cfg.twilioAccountSid,
          cfg.twilioAuthToken,
          cfg.twilioWhatsappNumber || '',
          db.alerts,
          process.env.STATUS_CALLBACK_URL
        )
      : new MockWhatsAppGateway()
  );

  const gateway = new DurableWhatsAppGateway(db,rawGateway,{enforceWindow:cfg.nodeEnv==='production' && cfg.mode!=='simulator',templates:{reminder:process.env.WHATSAPP_TEMPLATE_REMINDER || '',invoice:process.env.WHATSAPP_TEMPLATE_INVOICE || '',schedule_change:process.env.WHATSAPP_TEMPLATE_SCHEDULE_CHANGE || '',admin_alert:process.env.WHATSAPP_TEMPLATE_ADMIN_ALERT || ''}});

  // 3. Calendar
  const calendar = options.calendar || (
    cfg.mode !== 'simulator' && cfg.googleCalendarClientId && cfg.googleCalendarClientSecret
      ? new GoogleCalendarProvider({
          clientId: cfg.googleCalendarClientId,
          clientSecret: cfg.googleCalendarClientSecret,
          calendarId: cfg.googleCalendarId || 'primary',
          redirectUri: cfg.googleCalendarRedirectUri,
          getRefreshToken: () => db.settings.get('google_calendar_refresh_token', ''),
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
    cfg.mode !== 'simulator' && cfg.geminiApiKey
      ? new LiveGeminiClient(cfg.geminiApiKey)
      : new MockGeminiClient()
  );

  const agent = new AgentCore({
    client: geminiClient,
    scheduler,
    notifier,
  });

  // 7. Reminders & Billing
  const reminders = new ReminderRunner({ db, gateway, scheduler, notifier });
  const billing = new BillingService({ db, gateway });

  // 8. Express App
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(path.resolve(process.cwd(), 'public')));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });
  app.get('/ready',(_req,res)=>{const r=readiness(db,cfg);res.status(r.ready ? 200 : 503).json({ready:r.ready,mode:r.mode});});

  app.get('/simulator', (_req, res) => res.redirect('/admin/simulator'));

  // Twilio Webhooks
  const webhookRouter = createWebhookRouter({
    db,
    gateway,
    authToken: cfg.twilioAuthToken,
    publicBaseUrl: cfg.publicBaseUrl,
    asyncProcessing: cfg.nodeEnv === 'production',
    allowTestReset: cfg.mode === 'simulator' || cfg.nodeEnv === 'test',
    skipSignatureVerification: options.skipSignatureVerification ?? (cfg.nodeEnv !== 'production'),
    processMessage: async ({ customer, conversation, incomingText }) => {
      // Check if this incoming message is an interactive reminder confirmation (e.g. YES to confirm)
      const confirmationReply = await reminders.handleConfirmationResponse(customer.id, incomingText);
      if (confirmationReply) {
        return confirmationReply;
      }
      return agent.processMessage({ customer, conversation, incomingText, db });
    },
  });

  app.post('/api/webhook/whatsapp', webhookRouter.handleInboundMessage);
  app.post('/webhook/whatsapp', webhookRouter.handleInboundMessage);
  app.post('/api/webhook/whatsapp/status', webhookRouter.handleStatusCallback);
  app.post('/webhook/whatsapp/status', webhookRouter.handleStatusCallback);

  // Admin Dashboard & API
  const adminAuth = createAdminAuth(db, cfg.adminSessionSecret, { secure: cfg.nodeEnv === 'production', legacyQuery: cfg.nodeEnv === 'test', publicBaseUrl: cfg.publicBaseUrl });
  app.get('/admin/api/readiness',adminAuth.middleware,(_req,res)=>res.json(readiness(db,cfg)));
  const adminRouter = createAdminRouter({
    auth: adminAuth,
    calendarRedirectUri: cfg.googleCalendarRedirectUri,
    calendarClientId: cfg.googleCalendarClientId,
    calendarClientSecret: cfg.googleCalendarClientSecret,
    calendarId: cfg.googleCalendarId,
    db,
    billing,
    adminSecret: cfg.adminSessionSecret,
    scheduler,
    gateway,
    geminiClient,
  });
  app.use('/admin', adminRouter);

  // WhatsApp Simulator API (Zero-Twilio Testing Framework)
  const sandboxDb = createDatabaseContext(cfg.databaseUrl === ':memory:' ? ':memory:' : 'data/simulator.sqlite', { syncEnabled: false });
  const sandboxGateway = new MockWhatsAppGateway();
  const sandboxCalendar = new InMemoryCalendarProvider();
  const sandboxScheduler = new SchedulingEngine({ db: sandboxDb, calendar: sandboxCalendar });
  const sandboxNotifier = new AdminNotificationService({ gateway: sandboxGateway, adminWhatsappNumber: cfg.adminWhatsappNumber, alerts: sandboxDb.alerts });
  const sandboxAgent = new AgentCore({
    client: process.env.SIMULATOR_LIVE_AI === 'true' ? geminiClient : new MockGeminiClient(),
    scheduler: sandboxScheduler, notifier: sandboxNotifier,
  });
  const simulatorRouter = createSimulatorRouter({
    db: sandboxDb, agent: sandboxAgent,
    reminders: new ReminderRunner({ db: sandboxDb, gateway: sandboxGateway, scheduler: sandboxScheduler, notifier: sandboxNotifier }),
  });
  app.use('/api/simulator', adminAuth.middleware, simulatorRouter);

  return {
    app,
    db,
    gateway:rawGateway,
    replica,
    outbox:gateway,
    inbox:webhookRouter,
    calendar,
    scheduler,
    agent,
    reminders,
    billing,
    notifier,
    simulator: { db: sandboxDb, gateway: sandboxGateway },
  };
}
