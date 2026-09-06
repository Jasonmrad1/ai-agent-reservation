import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';

describe('Phase 1: Database & Repository Layer', () => {
  let ctx: DatabaseContext;

  beforeEach(() => {
    ctx = createDatabaseContext(':memory:');
  });

  describe('CustomerRepository', () => {
    it('creates and finds customer by phone', () => {
      const cust = ctx.customers.findOrCreate('whatsapp:+1234567890', 'Alice');
      expect(cust.id).toBeDefined();
      expect(cust.phone).toBe('whatsapp:+1234567890');
      expect(cust.name).toBe('Alice');
      expect(cust.opted_out).toBe(false);

      const found = ctx.customers.findByPhone('whatsapp:+1234567890');
      expect(found).not.toBeNull();
      expect(found?.id).toBe(cust.id);
    });

    it('updates customer name on re-discovery if provided', () => {
      ctx.customers.findOrCreate('whatsapp:+1234567890', 'Alice');
      const updated = ctx.customers.findOrCreate('whatsapp:+1234567890', 'Alice Smith');
      expect(updated.name).toBe('Alice Smith');
    });

    it('sets customer opt out state', () => {
      const cust = ctx.customers.findOrCreate('whatsapp:+1234567890');
      ctx.customers.setOptOut(cust.id, true);
      const fetched = ctx.customers.findById(cust.id);
      expect(fetched?.opted_out).toBe(true);
    });
  });

  describe('ConversationRepository & MessageRepository', () => {
    it('creates active conversation and logs messages', () => {
      const cust = ctx.customers.findOrCreate('whatsapp:+1000000000');
      const conv = ctx.conversations.getOrCreateActive(cust.id);
      expect(conv.status).toBe('active');

      const msg1 = ctx.messages.create(conv.id, 'inbound', 'Hello doctor', 'SM12345');
      expect(msg1.message_sid).toBe('SM12345');
      expect(msg1.body).toBe('Hello doctor');

      const msg2 = ctx.messages.create(conv.id, 'outbound', 'Hello! How can I help?', 'SM67890', 'sent');
      expect(msg2.direction).toBe('outbound');

      const history = ctx.messages.getRecentMessages(conv.id, 10);
      expect(history.length).toBe(2);
      expect(history[0].body).toBe('Hello doctor');
      expect(history[1].body).toBe('Hello! How can I help?');

      const bySid = ctx.messages.findByMessageSid('SM12345');
      expect(bySid?.id).toBe(msg1.id);
    });

    it('updates message status by sid', () => {
      const cust = ctx.customers.findOrCreate('whatsapp:+1000000001');
      const conv = ctx.conversations.getOrCreateActive(cust.id);
      ctx.messages.create(conv.id, 'outbound', 'Test message', 'SM_STATUS_1');

      ctx.messages.updateStatusBySid('SM_STATUS_1', 'delivered');
      const msg = ctx.messages.findByMessageSid('SM_STATUS_1');
      expect(msg?.status).toBe('delivered');
    });
  });

  describe('AppointmentRepository', () => {
    it('creates, reschedules, and cancels appointments', () => {
      const cust = ctx.customers.findOrCreate('whatsapp:+1111111111', 'Bob');
      const start = '2026-09-10T10:00:00.000Z';
      const end = '2026-09-10T11:00:00.000Z';

      const appt = ctx.appointments.create({
        customer_id: cust.id,
        visit_type: 'home_visit',
        address: '123 Main St, Springfield',
        service: 'General Consultation',
        price: 150,
        start_time: start,
        end_time: end,
      });

      expect(appt.visit_type).toBe('home_visit');
      expect(appt.address).toBe('123 Main St, Springfield');
      expect(appt.status).toBe('booked');

      // Reschedule
      const newStart = '2026-09-10T14:00:00.000Z';
      const newEnd = '2026-09-10T15:00:00.000Z';
      ctx.appointments.reschedule(appt.id, newStart, newEnd);

      const resched = ctx.appointments.findById(appt.id);
      expect(resched?.status).toBe('rescheduled');
      expect(resched?.start_time).toBe(newStart);

      // Cancel
      ctx.appointments.cancel(appt.id, 'Customer requested cancellation');
      const cancelled = ctx.appointments.findById(appt.id);
      expect(cancelled?.status).toBe('cancelled');
      expect(cancelled?.notes).toBe('Customer requested cancellation');
    });

    it('finds conflicting appointments in range', () => {
      const cust = ctx.customers.findOrCreate('whatsapp:+1111111112');
      ctx.appointments.create({
        customer_id: cust.id,
        visit_type: 'in_office',
        service: 'Checkup',
        price: 100,
        start_time: '2026-09-10T09:00:00.000Z',
        end_time: '2026-09-10T10:00:00.000Z',
      });

      const overlap = ctx.appointments.getAppointmentsInRange(
        '2026-09-10T09:30:00.000Z',
        '2026-09-10T10:30:00.000Z'
      );
      expect(overlap.length).toBe(1);

      const noOverlap = ctx.appointments.getAppointmentsInRange(
        '2026-09-10T10:00:00.000Z',
        '2026-09-10T11:00:00.000Z'
      );
      expect(noOverlap.length).toBe(0);
    });

    it('queries reminders correctly within time windows', () => {
      const cust = ctx.customers.findOrCreate('whatsapp:+1111111113');
      const baseNow = new Date('2026-09-10T10:00:00.000Z');

      // Appointment exactly 24h away
      const appt24 = ctx.appointments.create({
        customer_id: cust.id,
        visit_type: 'in_office',
        service: 'Checkup',
        price: 100,
        start_time: new Date(baseNow.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(baseNow.getTime() + 25 * 60 * 60 * 1000).toISOString(),
      });

      const pending24 = ctx.appointments.getPendingReminders('24h', baseNow);
      expect(pending24.length).toBe(1);
      expect(pending24[0].id).toBe(appt24.id);

      ctx.appointments.markReminderSent(appt24.id, '24h');
      const pendingAfter = ctx.appointments.getPendingReminders('24h', baseNow);
      expect(pendingAfter.length).toBe(0);
    });
  });

  describe('AvailabilityRepository', () => {
    it('seeds default weekly availability Mon-Fri 9-17', () => {
      const rules = ctx.availability.getAllRules();
      expect(rules.length).toBe(7);

      const monday = ctx.availability.getRuleForDay(1);
      expect(monday?.is_active).toBe(true);
      expect(monday?.start_time).toBe('09:00');
      expect(monday?.end_time).toBe('17:00');

      const sunday = ctx.availability.getRuleForDay(0);
      expect(sunday?.is_active).toBe(false);
    });

    it('updates weekly availability and manages overrides', () => {
      ctx.availability.updateRule(6, '10:00', '14:00', true);
      const saturday = ctx.availability.getRuleForDay(6);
      expect(saturday?.is_active).toBe(true);
      expect(saturday?.start_time).toBe('10:00');

      // Override for vacation
      const override = ctx.availability.setOverride({
        date: '2026-09-25',
        is_unavailable: true,
        reason: 'Conference in Boston',
      });
      expect(override.date).toBe('2026-09-25');

      const foundOverride = ctx.availability.getOverrideForDate('2026-09-25');
      expect(foundOverride?.is_unavailable).toBe(true);
      expect(foundOverride?.reason).toBe('Conference in Boston');

      ctx.availability.deleteOverride(foundOverride!.id);
      expect(ctx.availability.getOverrideForDate('2026-09-25')).toBeNull();
    });
  });

  describe('InvoiceRepository & AdminAlertRepository', () => {
    it('creates invoice and marks it paid', () => {
      const cust = ctx.customers.findOrCreate('whatsapp:+12223334444');
      const appt = ctx.appointments.create({
        customer_id: cust.id,
        visit_type: 'in_office',
        service: 'Acupuncture',
        price: 120,
        start_time: '2026-09-01T10:00:00.000Z',
        end_time: '2026-09-01T11:00:00.000Z',
      });

      const inv = ctx.invoices.create({
        appointment_id: appt.id,
        customer_id: cust.id,
        service_description: 'Acupuncture Session',
        amount: 120,
      });

      expect(inv.status).toBe('unpaid');
      expect(inv.amount).toBe(120);

      ctx.invoices.markPaid(inv.id);
      const updated = ctx.invoices.findById(inv.id);
      expect(updated?.status).toBe('paid');
      expect(updated?.paid_at).not.toBeNull();
    });

    it('creates and resolves admin alerts', () => {
      const alert = ctx.alerts.create({
        type: 'delivery_failure',
        title: 'WhatsApp Failed',
        details: 'Failed to deliver message after 3 retries',
      });

      expect(alert.status).toBe('pending');
      const pending = ctx.alerts.listPending();
      expect(pending.length).toBe(1);

      ctx.alerts.resolve(alert.id);
      expect(ctx.alerts.listPending().length).toBe(0);
    });
  });
});
