import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppInstance } from '../src/app.js';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { MockGeminiClient } from '../src/gemini/agent.js';

describe('Proactive Schedule Conflict Detection & Multi-Week Availability', () => {
  let instance: AppInstance;
  let adminKey = 'test-secret';
  let mockGateway: MockWhatsAppGateway;

  beforeEach(() => {
    const db = createDatabaseContext(':memory:');
    mockGateway = new MockWhatsAppGateway();
    const calendar = new InMemoryCalendarProvider();
    const geminiClient = new MockGeminiClient();

    instance = createApp({
      db,
      gateway: mockGateway,
      calendar,
      geminiClient,
      config: {
        port: 3000,
        nodeEnv: 'test',
        adminSessionSecret: adminKey,
        homeVisitBufferMinutes: 30,
        defaultSlotDurationMinutes: 60,
      },
    });
  });

  it('detects appointments when a doctor closes or shortens a weekday shift and auto-notifies affected patients', async () => {
    const { app, db } = instance;

    // 1. Create customer and upcoming appointment on Monday Sept 14, 2026 at 10:00 (10:00-11:00)
    const customer = db.customers.findOrCreate('whatsapp:+196170123456', 'Rami Khoury');

    const appt = db.appointments.create({
      customer_id: customer.id,
      service: 'General Consultation',
      visit_type: 'in_office',
      start_time: '2026-09-14T10:00:00.000Z', // Monday
      end_time: '2026-09-14T11:00:00.000Z',
      price: 120,
      status: 'booked',
    });

    // 2. Doctor closes Monday (day_of_week = 1)
    const res = await request(app)
      .post(`/admin/api/availability/rules?key=${adminKey}`)
      .send({
        day_of_week: 1,
        start_time: '09:00',
        end_time: '17:00',
        is_active: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.affectedCount).toBe(1);
    expect(res.body.notifiedPatients.length).toBe(1);
    expect(res.body.notifiedPatients[0].phone).toBe('whatsapp:+196170123456');

    // 3. Verify appointment status is updated to 'rescheduled'
    const updatedAppt = db.appointments.findById(appt.id);
    expect(updatedAppt?.status).toBe('booked');

    // 4. Verify WhatsApp message was sent through gateway
    expect(mockGateway.sentMessages.length).toBeGreaterThanOrEqual(1);
    const lastMsg = mockGateway.sentMessages[mockGateway.sentMessages.length - 1];
    expect(lastMsg.to).toBe('whatsapp:+196170123456');
    expect(lastMsg.body).toContain('reschedule');

    // 5. Verify admin alert was logged
    const alerts = db.alerts.listAll();
    expect(alerts.some((a) => a.type === 'schedule_conflict')).toBe(true);
  });

  it('detects appointments on a specific date when an override/holiday is added and auto-contacts affected customers', async () => {
    const { app, db } = instance;

    // 1. Create customer and upcoming appointment on Sept 16, 2026 (Wednesday)
    const customer = db.customers.findOrCreate('whatsapp:+196171987654', 'Nour Gemayel');

    const appt = db.appointments.create({
      customer_id: customer.id,
      service: 'Home Visit Care',
      visit_type: 'home_visit',
      address: 'Hamra Main St, Beirut',
      start_time: '2026-09-16T14:00:00.000Z',
      end_time: '2026-09-16T15:00:00.000Z',
      price: 180,
      status: 'booked',
    });

    // 2. Doctor sets vacation blockout for 2026-09-16
    const res = await request(app)
      .post(`/admin/api/availability/overrides?key=${adminKey}`)
      .send({
        date: '2026-09-16',
        is_unavailable: true,
        reason: 'Medical Conference in Paris',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.affectedCount).toBe(1);
    expect(res.body.notifiedPatients[0].customerName).toBe('Nour Gemayel');

    // 3. Verify appointment status updated and alert generated
    const updated = db.appointments.findById(appt.id);
    expect(updated?.status).toBe('booked');
  });

  it('searches multi-week availability across future weeks correctly', async () => {
    const { scheduler } = instance;

    // Search across 14 days starting from Monday 2026-09-14
    const openDays = await scheduler.getAvailableSlotsAcrossRange('2026-09-14', 14, 'in_office', 5);

    expect(openDays.length).toBeGreaterThanOrEqual(4);
    expect(openDays[0].date).toBe('2026-09-14');
    expect(openDays[0].available_slots.length).toBeGreaterThan(0);
    expect(openDays[1].date).toBe('2026-09-15');
  });
});