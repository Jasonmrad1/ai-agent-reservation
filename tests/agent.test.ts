import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { AdminNotificationService } from '../src/notifications/admin.notifier.js';
import { AgentCore, MockGeminiClient } from '../src/gemini/index.js';

describe('Phase 4: Gemini AI Integration & Tool-Calling Agent Core', () => {
  let db: DatabaseContext;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;
  let gateway: MockWhatsAppGateway;
  let notifier: AdminNotificationService;
  let geminiClient: MockGeminiClient;
  let agent: AgentCore;

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    calendar = new InMemoryCalendarProvider();
    scheduler = new SchedulingEngine({ db, calendar, homeVisitBufferMinutes: 30 });
    gateway = new MockWhatsAppGateway();
    notifier = new AdminNotificationService({
      gateway,
      adminWhatsappNumber: 'whatsapp:+15550001111',
      alerts: db.alerts,
    });
    geminiClient = new MockGeminiClient();
    agent = new AgentCore({
      client: geminiClient,
      scheduler,
      notifier,
    });
  });

  it('checks availability via tool call and formats slots', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+1234567890', 'Alice');
    const conv = db.conversations.getOrCreateActive(cust.id);

    // 2026-09-14 is Monday
    geminiClient.mockToolCall = {
      name: 'check_availability',
      args: { date: '2026-09-14', visit_type: 'in_office' },
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'When are you free next Monday?',
      db,
    });

    expect(reply).toContain('Available slots on 2026-09-14');
    expect(reply).toContain('09:00');
  });

  it('books an in-office appointment and triggers admin notification', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+1234567890', 'Alice');
    const conv = db.conversations.getOrCreateActive(cust.id);

    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '11:00',
        visit_type: 'in_office',
        service: 'General Consultation',
      },
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'Please book me for Monday at 11am for a general consultation',
      db,
    });

    expect(reply).toContain('confirmed');

    // Verify DB appointment
    const appts = db.appointments.findUpcomingByCustomerId(cust.id);
    expect(appts.length).toBe(1);
    expect(appts[0].visit_type).toBe('in_office');
    expect(appts[0].status).toBe('booked');

    // Verify Admin Notification was sent to admin phone
    expect(gateway.sentMessages.length).toBe(1);
    expect(gateway.sentMessages[0].to).toBe('whatsapp:+15550001111');
    expect(gateway.sentMessages[0].body).toContain('NEW APPOINTMENT BOOKED');
    expect(gateway.sentMessages[0].body).toContain('In-Office Visit');
  });

  it('enforces home address when booking home visit', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+1234567891', 'Bob');
    const conv = db.conversations.getOrCreateActive(cust.id);

    // Attempt booking home visit without address
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '13:00',
        visit_type: 'home_visit',
        service: 'Home Visit Care',
      },
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'I need a doctor to visit me at home at 1pm',
      db,
    });

    expect(reply).toContain('Home address is required');
    expect(db.appointments.findUpcomingByCustomerId(cust.id).length).toBe(0);

    // Now with address
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '13:00',
        visit_type: 'home_visit',
        service: 'Home Visit Care',
        address: '742 Evergreen Terrace',
      },
    };

    const reply2 = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'My address is 742 Evergreen Terrace',
      db,
    });

    expect(reply2).toContain('confirmed');
    const homeAppt = db.appointments.findUpcomingByCustomerId(cust.id);
    expect(homeAppt.length).toBe(1);
    expect(homeAppt[0].visit_type).toBe('home_visit');
    expect(homeAppt[0].address).toBe('742 Evergreen Terrace');
    expect(gateway.sentMessages.some((m) => m.body.includes('742 Evergreen Terrace'))).toBe(true);
  });

  it('reschedules an existing appointment and notifies admin', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+1234567892', 'Charlie');
    const conv = db.conversations.getOrCreateActive(cust.id);

    // Initial appointment
    db.appointments.create({
      customer_id: cust.id,
      visit_type: 'in_office',
      service: 'General Consultation',
      price: 120,
      start_time: '2026-09-14T09:00:00.000Z',
      end_time: '2026-09-14T10:00:00.000Z',
    });

    geminiClient.mockToolCall = {
      name: 'reschedule_appointment',
      args: { new_date: '2026-09-14', new_time: '15:00' },
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'Can I move my appointment to 3pm?',
      db,
    });

    expect(reply).toContain('rescheduled');
    const appt = db.appointments.findLatestActiveByCustomerId(cust.id);
    expect(appt?.status).toBe('rescheduled');
    expect(appt?.start_time).toContain('15:00');

    expect(gateway.sentMessages.some((m) => m.body.includes('APPOINTMENT RESCHEDULED'))).toBe(true);
  });

  it('cancels appointment and notifies admin', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+1234567893', 'David');
    const conv = db.conversations.getOrCreateActive(cust.id);

    const initial = db.appointments.create({
      customer_id: cust.id,
      visit_type: 'in_office',
      service: 'General Consultation',
      price: 120,
      start_time: '2026-09-14T11:00:00.000Z',
      end_time: '2026-09-14T12:00:00.000Z',
    });

    geminiClient.mockToolCall = {
      name: 'cancel_appointment',
      args: { reason: 'Feeling better' },
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'Please cancel my appointment',
      db,
    });

    expect(reply).toContain('cancelled');
    const cancelled = db.appointments.findById(initial.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(gateway.sentMessages.some((m) => m.body.includes('APPOINTMENT CANCELLED'))).toBe(true);
  });

  it('triggers human escalation on explicit customer demand', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+1234567894', 'Eve');
    const conv = db.conversations.getOrCreateActive(cust.id);

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'I need to speak with person right now',
      db,
    });

    expect(reply).toContain('informed Dr. Ziad and our clinic team');
    const updatedConv = db.conversations.findActiveByCustomerId(cust.id);
    expect(updatedConv?.status).toBe('escalated');

    const alerts = db.alerts.listPending();
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('human_handoff');

    expect(gateway.sentMessages.some((m) => m.body.includes('HUMAN HANDOFF REQUESTED'))).toBe(true);
  });

  it('retrieves clinic services and policies without hallucinating', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+1234567895', 'Frank');
    const conv = db.conversations.getOrCreateActive(cust.id);

    geminiClient.mockToolCall = {
      name: 'get_services_and_policies',
      args: {},
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'What are your prices and services?',
      db,
    });

    expect(reply).toContain('General Consultations ($120)');
    expect(reply).toContain('Home Visits ($180)');
  });
});
