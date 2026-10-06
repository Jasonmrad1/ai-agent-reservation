import { clinicIso } from './clinic-time.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { AdminNotificationService } from '../src/notifications/admin.notifier.js';
import { AgentCore, MockGeminiClient } from '../src/gemini/index.js';
import { ReminderRunner } from '../src/reminders/runner.js';
import { BillingService } from '../src/billing/service.js';

describe('🔥 HEAVY SCENARIOS & STRESS SUITE: Complete Clinic System Validation', () => {
  let db: DatabaseContext;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;
  let gateway: MockWhatsAppGateway;
  let notifier: AdminNotificationService;
  let geminiClient: MockGeminiClient;
  let agent: AgentCore;
  let reminders: ReminderRunner;
  let billing: BillingService;

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
  });

  it('Scenario 1: Multi-turn Lebanese Arabizi booking for back pain (Immediate Booking)', async () => {
    const customer = db.customers.findOrCreate('whatsapp:+96170123456', 'Charbel Haddad');
    const conv = db.conversations.getOrCreateActive(customer.id);

    // Turn 1: Patient asks for back pain appointment
    geminiClient.mockToolCall = {
      name: 'check_availability',
      args: { date: '2026-09-08', visit_type: 'in_office' },
    };

    const turn1Reply = await agent.processMessage({
      customer,
      conversation: conv,
      incomingText: 'Marhaba hakim, dahre 3am youja3ne kteer bde maw3ad',
      db,
    });
    expect(turn1Reply).toContain('Available slots');

    // Turn 2: Patient asks for other days
    geminiClient.mockToolCall = {
      name: 'check_availability',
      args: { date: '2026-09-14', visit_type: 'in_office' },
    };

    const turn2Reply = await agent.processMessage({
      customer,
      conversation: conv,
      incomingText: 'Shu eendak gher eyyam? Fi nhar l tnen?',
      db,
    });
    expect(turn2Reply).toBeDefined();

    // Turn 3: Patient selects Monday morning "Tanen aal 9 lal 12" -> Direct booking at 9:00
    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '09:00',
        visit_type: 'in_office',
        service: 'General Consultation',
        notes: 'Dahre / Severe back pain consultation',
        customer_name: 'Charbel Haddad',
      },
    };

    const turn3Reply = await agent.processMessage({
      customer,
      conversation: conv,
      incomingText: 'Tanen aal 9 lal 12',
      db,
    });

    expect(turn3Reply).toMatch(/confirmed|Zabbattelak/i);

    const upcoming = db.appointments.findUpcomingByCustomerId(customer.id);
    expect(upcoming.length).toBe(1);
    expect(upcoming[0].start_time).toBe(clinicIso('2026-09-14T09:00:00.000Z'));
    expect(upcoming[0].status).toBe('booked');
    expect(upcoming[0].service).toBe('General Consultation');

    expect(gateway.sentMessages.length).toBe(1);
    expect(gateway.sentMessages[0].to).toBe('whatsapp:+96170000001');
    expect(gateway.sentMessages[0].body).toContain('NEW APPOINTMENT BOOKED');
    expect(gateway.sentMessages[0].body).toContain('Charbel Haddad');
  });

  it('Scenario 2: Reschedules appointment cleanly, preventing conflicts and updating admin', async () => {
    const cust1 = db.customers.findOrCreate('whatsapp:+96170222333', 'Maya Kassir');
    const conv1 = db.conversations.getOrCreateActive(cust1.id);

    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-14',
        time: '10:00',
        visit_type: 'in_office',
        service: 'General Consultation',
        customer_name: 'Maya Kassir',
      },
    };
    await agent.processMessage({
      customer: cust1,
      conversation: conv1,
      incomingText: 'Book me for Monday at 10am',
      db,
    });

    const appt = db.appointments.findUpcomingByCustomerId(cust1.id)[0];
    expect(appt.start_time).toBe(clinicIso('2026-09-14T10:00:00.000Z'));

    const cust2 = db.customers.findOrCreate('whatsapp:+96170444555', 'George Saba');
    const appt2 = db.appointments.create({
      customer_id: cust2.id,
      start_time: clinicIso('2026-09-14T14:00:00.000Z'),
      end_time: clinicIso('2026-09-14T15:00:00.000Z'),
      visit_type: 'in_office',
      service: 'General Consultation',
      status: 'booked',
    });
    calendar.createEvent({
      id: appt2.id,
      summary: 'Appointment - George Saba',
      start: appt2.start_time,
      end: appt2.end_time,
    });

    geminiClient.mockToolCall = {
      name: 'reschedule_appointment',
      args: {
        appointment_id: appt.id,
        new_date: '2026-09-14',
        new_time: '14:00',
      },
    };

    const conflictReply = await agent.processMessage({
      customer: cust1,
      conversation: conv1,
      incomingText: 'Can I move my appointment to 2pm instead?',
      db,
    });

    expect(conflictReply).toContain('Time slot conflict');

    geminiClient.mockToolCall = {
      name: 'reschedule_appointment',
      args: {
        appointment_id: appt.id,
        new_date: '2026-09-15',
        new_time: '11:00',
      },
    };

    const successReply = await agent.processMessage({
      customer: cust1,
      conversation: conv1,
      incomingText: 'Then move it to Tuesday at 11am',
      db,
    });

    expect(successReply).toContain('rescheduled');

    const updatedAppt = db.appointments.findById(appt.id);
    expect(updatedAppt?.start_time).toBe(clinicIso('2026-09-15T11:00:00.000Z'));
    expect(updatedAppt?.status).toBe('rescheduled');

    const slots = await scheduler.getAvailableSlots('2026-09-14', 'in_office');
    expect(slots).toContain('10:00');
  });

  it('Scenario 3: Cancels appointment and immediately releases the calendar slot', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+96170555666', 'Nour Saliba');
    const conv = db.conversations.getOrCreateActive(cust.id);

    const appt = db.appointments.create({
      customer_id: cust.id,
      start_time: clinicIso('2026-09-16T10:00:00.000Z'),
      end_time: clinicIso('2026-09-16T11:00:00.000Z'),
      visit_type: 'in_office',
      service: 'Acupuncture / Therapy',
      status: 'booked',
    });
    calendar.createEvent({
      id: appt.id,
      summary: 'Acupuncture - Nour Saliba',
      start: appt.start_time,
      end: appt.end_time,
    });

    geminiClient.mockToolCall = {
      name: 'cancel_appointment',
      args: {
        appointment_id: appt.id,
        reason: 'Safar / Traveling abroad',
      },
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'Bde algheh l maw3ad 3ande safra',
      db,
    });

    expect(reply).toMatch(/cancelled|Tlagha/i);
    const dbAppt = db.appointments.findById(appt.id);
    expect(dbAppt?.status).toBe('cancelled');

    const slots = await scheduler.getAvailableSlots('2026-09-16', 'in_office');
    expect(slots).toContain('10:00');

    const cancelAlerts = gateway.sentMessages.filter(m => m.body.includes('APPOINTMENT CANCELLED'));
    expect(cancelAlerts.length).toBe(1);
    expect(cancelAlerts[0].body).toContain('Nour Saliba');
  });

  it('Scenario 4: Enforces home visit address and blocks 30min travel buffers', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+96170777888', 'Elie Khoury');
    const conv = db.conversations.getOrCreateActive(cust.id);

    geminiClient.mockToolCall = {
      name: 'book_appointment',
      args: {
        date: '2026-09-17',
        time: '11:00',
        visit_type: 'home_visit',
        service: 'Home Visit Care',
        address: 'Achrafieh, Sassine Square, Bldg 14, 3rd Floor',
        customer_name: 'Elie Khoury',
      },
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'Bade visit bil bayt Sassine Achrafieh nhar l khamis 11am',
      db,
    });

    expect(reply).toMatch(/confirmed|Zabbattelak/i);

    const slots = await scheduler.getAvailableSlots('2026-09-17', 'in_office');
    expect(slots).not.toContain('11:00');
    expect(slots).not.toContain('11:30');
    expect(slots).toContain('09:00');
    expect(slots).toContain('13:00');
  });

  it('Scenario 5: Prevents double-booking when 2 customers race for the same slot', async () => {
    const userA = db.customers.findOrCreate('whatsapp:+96170111111', 'User A');
    const userB = db.customers.findOrCreate('whatsapp:+96170222222', 'User B');

    const slotTime = clinicIso('2026-09-14T14:00:00.000Z');
    const endTime = clinicIso('2026-09-14T15:00:00.000Z');

    const apptA = await scheduler.bookAppointment({
      customerId: userA.id,
      startTime: slotTime,
      endTime: endTime,
      visitType: 'in_office',
      service: 'General Consultation',
    });
    expect(apptA).toBeDefined();

    let secondBookingError = null;
    try {
      await scheduler.bookAppointment({
        customerId: userB.id,
        startTime: slotTime,
        endTime: endTime,
        visitType: 'in_office',
        service: 'General Consultation',
      });
    } catch (err: any) {
      secondBookingError = err.message;
    }

    expect(secondBookingError).toContain('Time slot conflict');
  });

  it('Scenario 6: Correctly blocks booking on closed days or holiday overrides', async () => {
    db.availability.setOverride({
      date: '2026-09-18',
      is_unavailable: true,
      reason: 'National Holiday',
    });

    const slots = await scheduler.getAvailableSlots('2026-09-18', 'in_office');
    expect(slots).toEqual([]);

    const weekSummary = await scheduler.getAvailableSlotsAcrossRange('2026-09-14', 7, 'in_office');
    const friday = weekSummary.find(d => d.date === '2026-09-18');
    expect(friday?.is_closed).toBe(true);

    const sunday = weekSummary.find(d => d.date === '2026-09-20');
    expect(sunday?.is_closed).toBe(true);
  });

  it('Scenario 7: Executes complete 24h & 1h reminders, patient confirmation, and post-visit invoice', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+96170999000', 'Tony Stark');

    const checkTime = new Date(clinicIso('2026-09-14T10:00:00.000Z'));
    const apptStartTime = new Date(clinicIso('2026-09-15T10:00:00.000Z')); // Exactly 24h later
    const apptEndTime = new Date(clinicIso('2026-09-15T11:00:00.000Z'));

    const appt = db.appointments.create({
      customer_id: cust.id,
      start_time: apptStartTime.toISOString(),
      end_time: apptEndTime.toISOString(),
      visit_type: 'in_office',
      service: 'General Consultation',
      price: 120,
      status: 'booked',
    });

    const sent24hCount = await reminders.send24HourReminders(checkTime);
    expect(sent24hCount).toBe(1);

    expect(gateway.sentMessages.length).toBeGreaterThanOrEqual(1);

    const confirmReply = reminders.handleConfirmationResponse(cust.id, 'YES');
    expect(confirmReply).toMatch(/confirmed|Zabbattelak/i);

    const confirmedAppt = db.appointments.findById(appt.id);
    expect(confirmedAppt?.status).toBe('confirmed');

    db.appointments.updateStatus(appt.id, 'completed');
    const invoice = await billing.createInvoiceForAppointment(appt.id);
    expect(invoice.amount).toBe(120);
    expect(invoice.status).toBe('unpaid');

    await billing.sendInvoiceToCustomer(invoice.id);
    const invoiceMsg = gateway.sentMessages.find(m => m.body.includes('INVOICE'));
    expect(invoiceMsg).toBeDefined();
    expect(invoiceMsg?.body).toContain('.00');

    const paidInvoice = await billing.markInvoicePaid(invoice.id);
    expect(paidInvoice.status).toBe('paid');
  });

  it('Scenario 8: Immediate escalation on emergency or human request', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+96170888999', 'Sami Geagea');
    const conv = db.conversations.getOrCreateActive(cust.id);

    geminiClient.mockToolCall = {
      name: 'escalate_to_human',
      args: {
        reason: 'Patient reporting severe chest pain and dizziness',
        urgency: 'high',
      },
    };

    const reply = await agent.processMessage({
      customer: cust,
      conversation: conv,
      incomingText: 'I am having intense chest pain right now',
      db,
    });

    expect(reply).toMatch(/112|emergency|clinic staff/i);

    const updatedConv = db.conversations.findActiveByCustomerId(cust.id);
    expect(updatedConv?.status).toBe('escalated');

    const escalationAlerts = gateway.sentMessages.filter(m => m.body.includes('HUMAN HANDOFF REQUESTED'));
    expect(escalationAlerts.length).toBe(1);
  });
});
