import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { DatabaseContext, createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';

describe('Split Shifts & Road Commute Travel Buffer', () => {
  let db: DatabaseContext;
  let calendar: InMemoryCalendarProvider;
  let scheduler: SchedulingEngine;

  beforeEach(() => {
    db = createDatabaseContext(':memory:');
    calendar = new InMemoryCalendarProvider();
    scheduler = new SchedulingEngine({
      db,
      calendar,
      homeVisitBufferMinutes: 30,
      defaultSlotDurationMinutes: 60,
    });
  });

  describe('Non-continuous / Split Shifts', () => {
    it('generates slots only within active shift intervals and excludes breaks', async () => {
      // 2026-09-07 is Monday (day 1)
      // Set split shifts: Morning (09:00 - 13:00) and Evening (16:00 - 20:00) with 13:00-16:00 break
      db.availability.updateRule(1, '09:00', '20:00', true, [
        { start_time: '09:00', end_time: '13:00' },
        { start_time: '16:00', end_time: '20:00' },
      ]);

      const slots = await scheduler.getAvailableSlots('2026-09-07', 'in_office');

      // Morning shift slots exist
      expect(slots).toContain('09:00');
      expect(slots).toContain('10:00');
      expect(slots).toContain('11:00');
      expect(slots).toContain('12:00');

      // Afternoon break slots MUST NOT exist
      expect(slots).not.toContain('13:00');
      expect(slots).not.toContain('13:30');
      expect(slots).not.toContain('14:00');
      expect(slots).not.toContain('14:30');
      expect(slots).not.toContain('15:00');

      // Evening shift slots exist
      expect(slots).toContain('16:00');
      expect(slots).toContain('17:00');
      expect(slots).toContain('18:00');
      expect(slots).toContain('19:00');
    });

    it('rejects booking an appointment that falls into a shift break gap', async () => {
      db.availability.updateRule(1, '09:00', '20:00', true, [
        { start_time: '09:00', end_time: '13:00' },
        { start_time: '16:00', end_time: '20:00' },
      ]);

      const cust = db.customers.findOrCreate('whatsapp:+19998887777', 'Doctor Patient');

      // Attempt to book at 14:00 during break
      await expect(
        scheduler.bookAppointment({
          customerId: cust.id,
          customerPhone: cust.phone,
          visitType: 'in_office',
          service: 'Consultation',
          startTime: '2026-09-07T14:00:00.000Z',
          endTime: '2026-09-07T15:00:00.000Z',
        })
      ).rejects.toThrow(/outside doctor's active working hours/i);

      // Booking within evening shift succeeds
      const appt = await scheduler.bookAppointment({
        customerId: cust.id,
        customerPhone: cust.phone,
        visitType: 'in_office',
        service: 'Consultation',
        startTime: '2026-09-07T16:30:00.000Z',
        endTime: '2026-09-07T17:30:00.000Z',
      });
      expect(appt.status).toBe('booked');
    });
  });

  describe('Road Commute Travel Buffer Enforcement', () => {
    it('respects dynamically configured commute buffer between home visits and in-office', async () => {
      // Set commute buffer in settings to 45 minutes
      db.settings.set('home_visit_buffer_minutes', '45');
      expect(scheduler.getHomeVisitBufferMinutes()).toBe(45);

      const cust1 = db.customers.findOrCreate('whatsapp:+12223334444', 'Patient One');
      const cust2 = db.customers.findOrCreate('whatsapp:+12223335555', 'Patient Two');

      // Book Home Visit 10:00 - 11:00
      await scheduler.bookAppointment({
        customerId: cust1.id,
        customerPhone: cust1.phone,
        visitType: 'home_visit',
        address: '100 Sunset Blvd',
        service: 'Home Visit',
        startTime: '2026-09-07T10:00:00.000Z',
        endTime: '2026-09-07T11:00:00.000Z',
      });

      // With 45 min buffer, doctor is traveling until 11:45!
      // Booking at 11:30 must be blocked
      await expect(
        scheduler.bookAppointment({
          customerId: cust2.id,
          customerPhone: cust2.phone,
          visitType: 'in_office',
          service: 'Checkup',
          startTime: '2026-09-07T11:30:00.000Z',
          endTime: '2026-09-07T12:30:00.000Z',
        })
      ).rejects.toThrow(/travel buffer/i);

      // Booking at 11:45 succeeds!
      const appt2 = await scheduler.bookAppointment({
        customerId: cust2.id,
        customerPhone: cust2.phone,
        visitType: 'in_office',
        service: 'Checkup',
        startTime: '2026-09-07T11:45:00.000Z',
        endTime: '2026-09-07T12:45:00.000Z',
      });
      expect(appt2.status).toBe('booked');
    });

    it('manages settings and commute buffer via Admin API', async () => {
      const { app } = createApp({
        db,
        calendar,
        skipSignatureVerification: true,
      });

      const authHeader = 'Bearer admin-secret-2026';

      // 1. Get settings (default is 30)
      const getRes = await request(app)
        .get('/admin/api/settings')
        .set('Authorization', authHeader);
      expect(getRes.status).toBe(200);
      expect(getRes.body.home_visit_buffer_minutes).toBe(30);

      // 2. Update buffer to 60 mins
      const postRes = await request(app)
        .post('/admin/api/settings')
        .set('Authorization', authHeader)
        .send({ home_visit_buffer_minutes: 60 });
      expect(postRes.status).toBe(200);
      expect(postRes.body.home_visit_buffer_minutes).toBe(60);

      const updatedVal = db.settings.get('home_visit_buffer_minutes');
      expect(updatedVal).toBe('60');
    });

    it('allows first appointment at shift start without buffer and enforces commute buffer symmetrically between in-office and home visits', async () => {
      // Default Monday rule: 09:00 - 17:00, buffer 30 mins
      // 1. Without any reservations, the first available slot for BOTH in-office and home visits is 09:00
      const initialInOfficeSlots = await scheduler.getAvailableSlots('2026-09-07', 'in_office');
      expect(initialInOfficeSlots[0]).toBe('09:00');

      const initialHomeVisitSlots = await scheduler.getAvailableSlots('2026-09-07', 'home_visit');
      expect(initialHomeVisitSlots[0]).toBe('09:00');

      // 2. Book an in-office appointment from 09:00 to 10:00
      const custA = db.customers.findOrCreate('whatsapp:+96170111222', 'Patient Clinic');
      await scheduler.bookAppointment({
        customerId: custA.id,
        customerPhone: custA.phone,
        visitType: 'in_office',
        service: 'Consultation',
        startTime: '2026-09-07T09:00:00.000Z',
        endTime: '2026-09-07T10:00:00.000Z',
      });

      // 3. Immediately after in-office appointment (10:00):
      // - In-office visit can start at 10:00 (no travel needed)
      // - Home visit CANNOT start at 10:00 (doctor needs 30 min commute buffer from clinic to home)
      const afterClinicSlots = await scheduler.getAvailableSlots('2026-09-07', 'in_office');
      expect(afterClinicSlots).toContain('10:00');

      const afterClinicHomeSlots = await scheduler.getAvailableSlots('2026-09-07', 'home_visit');
      expect(afterClinicHomeSlots).not.toContain('10:00');
      expect(afterClinicHomeSlots).toContain('10:30');

      // Booking home visit at 10:00 fails due to commute buffer
      const custB = db.customers.findOrCreate('whatsapp:+96170333444', 'Patient Home');
      await expect(
        scheduler.bookAppointment({
          customerId: custB.id,
          customerPhone: custB.phone,
          visitType: 'home_visit',
          address: 'Downtown Beirut',
          service: 'Home Visit',
          startTime: '2026-09-07T10:00:00.000Z',
          endTime: '2026-09-07T11:00:00.000Z',
        })
      ).rejects.toThrow(/travel buffer|conflict/i);

      // 4. Book a home visit at 10:30 - 11:30
      await scheduler.bookAppointment({
        customerId: custB.id,
        customerPhone: custB.phone,
        visitType: 'home_visit',
        address: 'Downtown Beirut',
        service: 'Home Visit',
        startTime: '2026-09-07T10:30:00.000Z',
        endTime: '2026-09-07T11:30:00.000Z',
      });

      // 5. Now, because 10:30-11:30 was a HOME VISIT, doctor needs 30 min commute buffer to return:
      // - 11:30 is BLOCKED
      // - 12:00 is the earliest available slot
      const afterHomeSlots = await scheduler.getAvailableSlots('2026-09-07', 'in_office');
      expect(afterHomeSlots).not.toContain('11:30');
      expect(afterHomeSlots).toContain('12:00');

      // Booking at 11:30 must fail with travel buffer conflict
      const custC = db.customers.findOrCreate('whatsapp:+96170555666', 'Patient Next');
      await expect(
        scheduler.bookAppointment({
          customerId: custC.id,
          customerPhone: custC.phone,
          visitType: 'in_office',
          service: 'Checkup',
          startTime: '2026-09-07T11:30:00.000Z',
          endTime: '2026-09-07T12:30:00.000Z',
        })
      ).rejects.toThrow(/travel buffer/i);

      // Booking at 12:00 succeeds
      const apptC = await scheduler.bookAppointment({
        customerId: custC.id,
        customerPhone: custC.phone,
        visitType: 'in_office',
        service: 'Checkup',
        startTime: '2026-09-07T12:00:00.000Z',
        endTime: '2026-09-07T13:00:00.000Z',
      });
      expect(apptC.status).toBe('booked');
    });
  });
});
