import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { DatabaseContext, createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/agent.js';

describe('📅 DYNAMIC WEEKLY SCHEDULE & APPOINTMENT DEDUCTION SUITE', () => {
  let db: DatabaseContext;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;
  let gateway: MockWhatsAppGateway;
  let geminiClient: MockGeminiClient;
  let appInstance: AppInstance;

  const ADMIN_SECRET = 'dr_ziad_secret_2026';
  const CLINIC_WHATSAPP = 'whatsapp:+14155238886';
  const DOCTOR_PHONE = 'whatsapp:+96171476193';
  const PATIENT_PHONE = 'whatsapp:+96170123987';

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    calendar = new InMemoryCalendarProvider();
    scheduler = new SchedulingEngine({
      db,
      calendar,
      homeVisitBufferMinutes: 30,
      defaultSlotDurationMinutes: 60,
    });
    gateway = new MockWhatsAppGateway();
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

  it('calculates full weekly open slots and accurately minuses existing booked appointments from the database', async () => {
    // 2026-09-14 is Monday
    const mondayStr = '2026-09-14';
    const wednesdayStr = '2026-09-16';
    const thursdayStr = '2026-09-17';

    // 1. Book an appointment on Wednesday at 10:00 AM
    const patient1 = db.customers.findOrCreate('whatsapp:+96170111111', 'Patient One');
    db.appointments.create({
      customer_id: patient1.id,
      service: 'General Consultation',
      price: 120,
      start_time: `${wednesdayStr}T10:00:00.000Z`,
      end_time: `${wednesdayStr}T11:00:00.000Z`,
      visit_type: 'in_office',
    });

    // 2. Book an appointment on Thursday at 14:00 PM (2:00 PM)
    const patient2 = db.customers.findOrCreate('whatsapp:+96170222222', 'Patient Two');
    db.appointments.create({
      customer_id: patient2.id,
      service: 'General Consultation',
      price: 120,
      start_time: `${thursdayStr}T14:00:00.000Z`,
      end_time: `${thursdayStr}T15:00:00.000Z`,
      visit_type: 'in_office',
    });

    // 3. Query weekly availability starting from Monday for 7 days
    const weekSchedule = await scheduler.getAvailableSlotsAcrossRange(mondayStr, 7, 'in_office');
    expect(weekSchedule.length).toBe(7);

    // Monday (09:00 - 17:00 open, no bookings)
    const monday = weekSchedule.find((d) => d.date === mondayStr);
    expect(monday).toBeDefined();
    expect(monday?.is_closed).toBe(false);
    expect(monday?.available_slots).toContain('09:00');
    expect(monday?.available_slots).toContain('10:00');
    expect(monday?.available_slots).toContain('14:00');

    // Wednesday: 10:00 AM must be deducted!
    const wednesday = weekSchedule.find((d) => d.date === wednesdayStr);
    expect(wednesday).toBeDefined();
    expect(wednesday?.is_closed).toBe(false);
    expect(wednesday?.available_slots).not.toContain('10:00'); // MINUSED!
    expect(wednesday?.available_slots).toContain('09:00');
    expect(wednesday?.available_slots).toContain('11:00');
    expect(wednesday?.available_slots).toContain('14:00');

    // Thursday: 14:00 PM must be deducted!
    const thursday = weekSchedule.find((d) => d.date === thursdayStr);
    expect(thursday).toBeDefined();
    expect(thursday?.is_closed).toBe(false);
    expect(thursday?.available_slots).not.toContain('14:00'); // MINUSED!
    expect(thursday?.available_slots).toContain('09:00');
    expect(thursday?.available_slots).toContain('10:00');
    expect(thursday?.available_slots).toContain('15:00');

    // Saturday & Sunday (2026-09-19 & 2026-09-20) must be closed
    const saturday = weekSchedule.find((d) => d.date === '2026-09-19');
    const sunday = weekSchedule.find((d) => d.date === '2026-09-20');
    expect(saturday?.is_closed).toBe(true);
    expect(saturday?.available_slots.length).toBe(0);
    expect(sunday?.is_closed).toBe(true);
    expect(sunday?.available_slots.length).toBe(0);
  });

  it('minuses home visit travel buffers (30 mins before and after) from available slots', async () => {
    const fridayStr = '2026-09-18';

    // Book a home visit at 11:00 AM - 12:00 PM on Friday
    const patientHome = db.customers.findOrCreate('whatsapp:+96170333333', 'Home Patient');
    db.appointments.create({
      customer_id: patientHome.id,
      service: 'Home Visit Care',
      price: 180,
      start_time: `${fridayStr}T11:00:00.000Z`,
      end_time: `${fridayStr}T12:00:00.000Z`,
      visit_type: 'home_visit',
      address: 'Achrafieh, Beirut',
    });

    // In-office slots on Friday
    const inOfficeSlots = await scheduler.getAvailableSlots(fridayStr, 'in_office');
    // Direct overlap at 11:00 must be gone
    expect(inOfficeSlots).not.toContain('11:00');
    expect(inOfficeSlots).not.toContain('11:30');

    // Home visit slots on Friday (requires 30m travel buffer before & after)
    const homeSlots = await scheduler.getAvailableSlots(fridayStr, 'home_visit');
    expect(homeSlots).not.toContain('11:00');
    // 10:30 slot conflicts with 30m travel buffer before 11:00 home visit
    expect(homeSlots).not.toContain('10:30');
    // 12:00 slot conflicts with 30m travel buffer after 12:00 home visit return
    expect(homeSlots).not.toContain('12:00');
    // 12:30 is safe
    expect(homeSlots).toContain('12:30');
  });

  it('processes patient WhatsApp inquiry for weekly availability and returns accurate day-by-day slots', async () => {
    const { app } = appInstance;

    geminiClient.mockToolCall = {
      name: 'check_availability',
      args: {
        date: '2026-09-14',
        visit_type: 'in_office',
      },
    };

    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .send({
        From: PATIENT_PHONE,
        To: CLINIC_WHATSAPP,
        Body: 'Hello! What are your available time slots for this week?',
        MessageSid: 'SM_WEEK_AVAIL_01',
        ProfileName: 'Jason',
      });

    expect(res.status).toBe(200);

    const reply = gateway.sentMessages.find((m) => m.to === PATIENT_PHONE);
    expect(reply).toBeDefined();
    expect(reply?.body).toContain('2026-09-14');
    expect(reply?.body).toMatch(/available|slots|time/i);
  });
});
