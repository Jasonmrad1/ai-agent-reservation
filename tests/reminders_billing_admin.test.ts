import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { MockWhatsAppGateway } from '../src/twilio/client.js';
import { ReminderRunner } from '../src/reminders/runner.js';
import { BillingService } from '../src/billing/service.js';
import { createAdminRouter } from '../src/admin/routes.js';

describe('Phases 5, 6, 7: Reminders, Billing, & Admin Dashboard', () => {
  let db: DatabaseContext;
  let gateway: MockWhatsAppGateway;
  let reminders: ReminderRunner;
  let billing: BillingService;
  let app: express.Application;
  const ADMIN_SECRET = 'test_secret_123';

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    gateway = new MockWhatsAppGateway();
    reminders = new ReminderRunner({ db, gateway });
    billing = new BillingService({ db, gateway });

    app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter({ db, billing, adminSecret: ADMIN_SECRET }));
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

    it('renders admin HTML dashboard page', async () => {
      const res = await request(app).get(`/admin/dashboard?key=${ADMIN_SECRET}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Dr. Robert Smith - Practice Management Dashboard');
      expect(res.text).toContain('Upcoming Appointments');
      expect(res.text).toContain('Weekly Availability');
    });
  });
});
