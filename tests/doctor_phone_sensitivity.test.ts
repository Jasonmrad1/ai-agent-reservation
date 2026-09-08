import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { AdminNotificationService } from '../src/notifications/admin.notifier.js';
import { AgentCore, MockGeminiClient } from '../src/gemini/index.js';

describe('👨‍⚕️ DOCTOR DIRECT PHONE SENSITIVITY & EXECUTIVE ASSISTANT SUITE', () => {
  let db: DatabaseContext;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;
  let gateway: MockWhatsAppGateway;
  let notifier: AdminNotificationService;
  let geminiClient: MockGeminiClient;
  let agent: AgentCore;
  const DOCTOR_PHONE = 'whatsapp:+96171476193';

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    calendar = new InMemoryCalendarProvider();
    scheduler = new SchedulingEngine({ db, calendar, homeVisitBufferMinutes: 30 });
    gateway = new MockWhatsAppGateway();
    notifier = new AdminNotificationService({
      gateway,
      adminWhatsappNumber: DOCTOR_PHONE,
      alerts: db.alerts,
    });
    geminiClient = new MockGeminiClient();
    agent = new AgentCore({
      client: geminiClient,
      scheduler,
      notifier,
    });
  });

  it('1. Recognizes Doctor phone and provides schedule overview instead of patient booking prompt', async () => {
    const doctorCust = db.customers.findOrCreate(DOCTOR_PHONE, 'Dr. Smith');
    const doctorConv = db.conversations.getOrCreateActive(doctorCust.id);

    // Seed 2 patient appointments
    const patient1 = db.customers.findOrCreate('whatsapp:+96170111222', 'Jason Mrad');
    db.appointments.create({
      customer_id: patient1.id,
      start_time: '2026-09-14T09:30:00.000Z',
      end_time: '2026-09-14T10:30:00.000Z',
      visit_type: 'in_office',
      service: 'General Consultation',
      status: 'confirmed',
    });

    const patient2 = db.customers.findOrCreate('whatsapp:+96170333444', 'Elie Khoury');
    db.appointments.create({
      customer_id: patient2.id,
      start_time: '2026-09-14T14:00:00.000Z',
      end_time: '2026-09-14T15:00:00.000Z',
      visit_type: 'home_visit',
      address: 'Achrafieh, Sassine',
      service: 'Home Visit Care',
      status: 'booked',
    });

    const reply = await agent.processMessage({
      customer: doctorCust,
      conversation: doctorConv,
      incomingText: 'Show me my schedule for appointments',
      db,
    });

    // Verify response is tailored to the Doctor
    expect(reply).toContain('Doctor Schedule Overview');
    expect(reply).toContain('Jason Mrad');
    expect(reply).toContain('Elie Khoury');
    expect(reply).toContain('Total: 2 active visit(s)');
    // Never ask doctor patient questions
    expect(reply).not.toContain('What brings you in?');
    expect(reply).not.toContain('Would you like to book?');
  });

  it('2. Directly executes Doctor blockout command over WhatsApp without confusion', async () => {
    const doctorCust = db.customers.findOrCreate(DOCTOR_PHONE, 'Dr. Smith');
    const doctorConv = db.conversations.getOrCreateActive(doctorCust.id);

    const reply = await agent.processMessage({
      customer: doctorCust,
      conversation: doctorConv,
      incomingText: 'Block tomorrow from my schedule',
      db,
    });

    expect(reply).toContain('Done Doctor!');
    expect(reply).toContain('blocked out');

    // Verify override created in database
    const overrides = db.availability.getAllOverrides();
    expect(overrides.length).toBe(1);
    expect(overrides[0].is_unavailable).toBe(true);
  });

  it('3. Regular patients still receive warm patient booking flow', async () => {
    const patientCust = db.customers.findOrCreate('whatsapp:+96170888777', 'Charbel');
    const patientConv = db.conversations.getOrCreateActive(patientCust.id);

    geminiClient.mockToolCall = {
      name: 'check_availability',
      args: { date: '2026-09-14', visit_type: 'in_office' },
    };

    const reply = await agent.processMessage({
      customer: patientCust,
      conversation: patientConv,
      incomingText: 'Bde maw3ad la dahre hakim',
      db,
    });

    expect(reply).toContain('Available slots');
  });
});
