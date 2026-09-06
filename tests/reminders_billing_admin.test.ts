import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { ReminderRunner } from '../src/reminders/runner.js';
import { BillingService } from '../src/billing/service.js';
import { createAdminRouter } from '../src/admin/routes.js';

import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
import { MockGeminiClient } from '../src/gemini/index.js';

describe('Phases 5, 6, 7: Reminders, Billing, & Admin Dashboard', () => {
  let db: DatabaseContext;
  let gateway: MockWhatsAppGateway;
  let reminders: ReminderRunner;
  let billing: BillingService;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;
  let geminiClient: MockGeminiClient;
  let app: express.Application;
  const ADMIN_SECRET = 'test_secret_123';

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    gateway = new MockWhatsAppGateway();
    reminders = new ReminderRunner({ db, gateway });
    billing = new BillingService({ db, gateway });
    calendar = new InMemoryCalendarProvider();
    scheduler = new SchedulingEngine({ db, calendar });
    geminiClient = new MockGeminiClient();

    app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter({
      db,
      billing,
      adminSecret: ADMIN_SECRET,
      scheduler,
      gateway,
      geminiClient,
    }));
  });

  describe('Phase 5: Outbound Reminders', () => {
    it('sends 24-hour reminder idempotently and handles confirmation response', async () => {
      const cust = db.customers.findOrCreate('whatsapp:+15551112222', 'George');
      const baseNow = new Date('2026-09-10T12:00:00.000Z');
      const start24h = new Date(baseNow.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const end24h = new Date(baseNow.getTime() + 25 * 60 * 60 * 1000).toISOString();

      const appt = db.appointments.create({
        customer_id: cust.id,
        visit_type: 'home_visit',
        address: '100 Main St',
        service: 'General Consultation',
        price: 120,
        start_time: start24h,
        end_time: end24h,
      });

      // 1. Trigger 24h reminder
      const sentCount = await reminders.send24HourReminders(baseNow);
      expect(sentCount).toBe(1);
      expect(gateway.sentMessages.length).toBe(1);
      expect(gateway.sentMessages[0].body).toContain('100 Main St');
      expect(gateway.sentMessages[0].body).toContain('YES');

      // 2. Idempotency: second run within same window sends 0
      const secondRun = await reminders.send24HourReminders(baseNow);
      expect(secondRun).toBe(0);

      // 3. Confirmation response
      const confirmReply = reminders.handleConfirmationResponse(cust.id, 'YES');
      expect(confirmReply).toContain('confirmed');

      const updated = db.appointments.findById(appt.id);
      expect(updated?.status).toBe('confirmed');
    });

    it('sends 1-hour reminder within time window', async () => {
      const cust = db.customers.findOrCreate('whatsapp:+15551112223', 'Hannah');
      const baseNow = new Date('2026-09-10T12:00:00.000Z');
      const start1h = new Date(baseNow.getTime() + 60 * 60 * 1000).toISOString();
      const end1h = new Date(baseNow.getTime() + 120 * 60 * 1000).toISOString();

      db.appointments.create({
        customer_id: cust.id,
        visit_type: 'in_office',
        service: 'Follow-up',
        price: 70,
        start_time: start1h,
        end_time: end1h,
      });

      const sentCount = await reminders.send1HourReminders(baseNow);
      expect(sentCount).toBe(1);
      expect(gateway.sentMessages[0].body).toContain('in about 1 hour');
    });
  });

  describe('Phase 7: Billing Engine', () => {
    it('creates accurate invoice from completed appointment and marks paid', async () => {
      const cust = db.customers.findOrCreate('whatsapp:+15551112224', 'Ian');
      const appt = db.appointments.create({
        customer_id: cust.id,
        visit_type: 'in_office',
        service: 'Acupuncture / Therapy',
        price: 130,
        start_time: '2026-09-08T10:00:00.000Z',
        end_time: '2026-09-08T11:00:00.000Z',
      });

      // Complete and bill
      const result = await billing.completeAppointmentAndBill(appt.id);
      expect(result.appointment.status).toBe('completed');
      expect(result.invoice.amount).toBe(130);
      expect(result.invoice.status).toBe('unpaid');

      // WhatsApp invoice was sent
      expect(gateway.sentMessages.some((m) => m.body.includes('INVOICE / RECEIPT'))).toBe(true);

      // Patient pays
      gateway.clear();
      const paidInvoice = await billing.markInvoicePaid(result.invoice.id);
      expect(paidInvoice.status).toBe('paid');
      expect(gateway.sentMessages.some((m) => m.body.includes('PAYMENT CONFIRMATION'))).toBe(true);
    });
  });

  describe('Phase 6: Admin Dashboard & Web API', () => {
    it('rejects unauthenticated requests to admin API', async () => {
      const res = await request(app).get('/admin/api/appointments');
      expect(res.status).toBe(401);
    });

    it('allows authenticated admin to manage availability, appointments, and billing', async () => {
      const authHeader = `Bearer ${ADMIN_SECRET}`;

      // 1. Get availability
      const availRes = await request(app)
        .get('/admin/api/availability')
        .set('Authorization', authHeader);
      expect(availRes.status).toBe(200);
      expect(availRes.body.rules.length).toBe(7);

      // 2. Add vacation override
      const overrideRes = await request(app)
        .post('/admin/api/availability/overrides')
        .set('Authorization', authHeader)
        .send({
          date: '2026-09-18',
          is_unavailable: true,
          reason: 'Medical Conference',
        });
      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.override.date).toBe('2026-09-18');

      // 3. Create an appointment in DB to test admin listing & completion
      const cust = db.customers.findOrCreate('whatsapp:+15551112225', 'Julia');
      const appt = db.appointments.create({
        customer_id: cust.id,
        visit_type: 'home_visit',
        address: '55 Ocean Ave',
        service: 'Home Visit Care',
        price: 180,
        start_time: '2026-09-10T14:00:00.000Z',
        end_time: '2026-09-10T15:00:00.000Z',
      });

      const apptsRes = await request(app)
        .get('/admin/api/appointments')
        .set('Authorization', authHeader);
      expect(apptsRes.status).toBe(200);
      expect(apptsRes.body.appointments.length).toBeGreaterThan(0);
      expect(apptsRes.body.appointments[0].customer_name).toBe('Julia');

      // 4. Complete appointment & bill via Admin API
      const completeRes = await request(app)
        .post(`/admin/api/appointments/${appt.id}/complete`)
        .set('Authorization', authHeader);
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.invoice.amount).toBe(180);

      // 5. Mark invoice paid via Admin API
      const payRes = await request(app)
        .post(`/admin/api/invoices/${completeRes.body.invoice.id}/pay`)
        .set('Authorization', authHeader);
      expect(payRes.status).toBe(200);
      expect(payRes.body.invoice.status).toBe('paid');

      // 6. Manage Alerts
      const alert = db.alerts.create({
        type: 'human_handoff',
        title: 'Emergency Question',
        details: 'Patient has high fever',
      });

      const alertsRes = await request(app)
        .get('/admin/api/alerts')
        .set('Authorization', authHeader);
      expect(alertsRes.body.alerts.length).toBe(1);

      const resolveRes = await request(app)
        .post(`/admin/api/alerts/${alert.id}/resolve`)
        .set('Authorization', authHeader);
      expect(resolveRes.status).toBe(200);

      const resolvedList = await request(app)
        .get('/admin/api/alerts')
        .set('Authorization', authHeader);
      expect(resolvedList.body.alerts[0].status).toBe('resolved');
    });

    it('allows the doctor to explicitly set work hours in batch', async () => {
      const authHeader = `Bearer ${ADMIN_SECRET}`;

      const newHours = [
        { day_of_week: 1, start_time: '08:00', end_time: '18:00', is_active: true }, // Monday 8-18
        { day_of_week: 2, start_time: '08:00', end_time: '18:00', is_active: true },
        { day_of_week: 3, start_time: '08:00', end_time: '18:00', is_active: true },
        { day_of_week: 4, start_time: '08:00', end_time: '18:00', is_active: true },
        { day_of_week: 5, start_time: '08:00', end_time: '16:00', is_active: true },
        { day_of_week: 6, start_time: '10:00', end_time: '14:00', is_active: true }, // Saturday open
        { day_of_week: 0, start_time: '09:00', end_time: '13:00', is_active: false }, // Sunday closed
      ];

      const res = await request(app)
        .post('/admin/api/availability/rules/batch')
        .set('Authorization', authHeader)
        .send({ rules: newHours });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const mon = db.availability.getRuleForDay(1);
      expect(mon?.start_time).toBe('08:00');
      expect(mon?.end_time).toBe('18:00');

      const sat = db.availability.getRuleForDay(6);
      expect(sat?.is_active).toBe(true);
      expect(sat?.start_time).toBe('10:00');
    });

    it('prompts the AI from the panel to reschedule an appointment with the client', async () => {
      const authHeader = `Bearer ${ADMIN_SECRET}`;

      // Create patient and appointment
      const cust = db.customers.findOrCreate('whatsapp:+15557778888', 'Michael');
      const appt = db.appointments.create({
        customer_id: cust.id,
        visit_type: 'in_office',
        service: 'General Consultation',
        price: 120,
        start_time: '2026-09-08T09:00:00.000Z',
        end_time: '2026-09-08T10:00:00.000Z',
      });

      gateway.clear();

      // Doctor triggers AI reschedule request from admin panel with custom directive
      const res = await request(app)
        .post(`/admin/api/appointments/${appt.id}/request-reschedule`)
        .set('Authorization', authHeader)
        .send({
          doctorPrompt: 'Doctor called into emergency surgery Tuesday morning. Offer Wednesday or Thursday.',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.messageSent).toContain('emergency surgery');
      expect(res.body.messageSent).toContain('Michael');

      // WhatsApp message was dispatched to the patient
      expect(gateway.sentMessages.length).toBe(1);
      expect(gateway.sentMessages[0].to).toBe('whatsapp:+15557778888');
      expect(gateway.sentMessages[0].body).toContain('emergency surgery');

      // Appointment updated to rescheduled status in DB with notes
      const updatedAppt = db.appointments.findById(appt.id);
      expect(updatedAppt?.status).toBe('rescheduled');
      expect(updatedAppt?.notes).toContain('emergency surgery');
    });

    it('renders admin HTML dashboard page with work hours controls and AI reschedule button', async () => {
      const res = await request(app).get(`/admin/dashboard?key=${ADMIN_SECRET}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Weekly Work Hours');
      expect(res.text).toContain('Save All Weekly Hours');
      expect(res.text).toContain('AI Reschedule');
    });
  });
});
