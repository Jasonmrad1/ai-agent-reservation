import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';

describe('Phase 3: Calendar Backend & Scheduling Engine', () => {
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

  it('generates slots on regular business days (e.g. Monday)', async () => {
    // 2026-09-07 is a Monday
    const slots = await scheduler.getAvailableSlots('2026-09-07', 'in_office');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots).toContain('09:00');
    expect(slots).toContain('10:00');
    expect(slots).toContain('16:00');
  });

  it('returns no slots on closed days (e.g. Sunday)', async () => {
    // 2026-09-06 is a Sunday (inactive in default rules)
    const slots = await scheduler.getAvailableSlots('2026-09-06', 'in_office');
    expect(slots.length).toBe(0);
  });

  it('returns no slots on holiday/vacation override', async () => {
    // 2026-09-07 is Monday, set vacation override
    db.availability.setOverride({
      date: '2026-09-07',
      is_unavailable: true,
      reason: 'Labor Day',
    });

    const slots = await scheduler.getAvailableSlots('2026-09-07', 'in_office');
    expect(slots.length).toBe(0);
  });

  it('books an in-office appointment and avoids double booking', async () => {
    const cust1 = db.customers.findOrCreate('whatsapp:+15550001001', 'Alice');
    const cust2 = db.customers.findOrCreate('whatsapp:+15550001002', 'Bob');

    const appt = await scheduler.bookAppointment({
      customerId: cust1.id,
      customerPhone: cust1.phone,
      customerName: cust1.name,
      visitType: 'in_office',
      service: 'General Consultation',
      price: 100,
      startTime: '2026-09-07T10:00:00.000Z',
      endTime: '2026-09-07T11:00:00.000Z',
    });

    expect(appt.id).toBeDefined();
    expect(appt.status).toBe('booked');
    expect(appt.google_event_id).toBeDefined();

    // Verify event in calendar
    const calEvents = await calendar.listEvents(
      new Date('2026-09-07T09:00:00.000Z'),
      new Date('2026-09-07T12:00:00.000Z')
    );
    expect(calEvents.length).toBe(1);
    expect(calEvents[0].summary).toContain('General Consultation');

    // Attempting to book the same slot must fail
    await expect(
      scheduler.bookAppointment({
        customerId: cust2.id,
        customerPhone: cust2.phone,
        visitType: 'in_office',
        service: 'Checkup',
        startTime: '2026-09-07T10:30:00.000Z',
        endTime: '2026-09-07T11:30:00.000Z',
      })
    ).rejects.toThrow('conflict');
  });

  it('enforces address requirement and travel time buffer for home visits', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+15550001003', 'Charlie');

    // Missing address
    await expect(
      scheduler.bookAppointment({
        customerId: cust.id,
        customerPhone: cust.phone,
        visitType: 'home_visit',
        service: 'Home Care',
        startTime: '2026-09-07T10:00:00.000Z',
      })
    ).rejects.toThrow('physical address is required');

    // Book valid home visit 10:00 - 11:00 (requires 30 min buffer: 09:30 to 11:30)
    await scheduler.bookAppointment({
      customerId: cust.id,
      customerPhone: cust.phone,
      visitType: 'home_visit',
      address: '456 Elm St, Cityville',
      service: 'Home Care',
      startTime: '2026-09-07T10:00:00.000Z',
      endTime: '2026-09-07T11:00:00.000Z',
    });

    const otherCust = db.customers.findOrCreate('whatsapp:+15550001004', 'David');

    // Booking at 11:15 fails due to travel buffer extending to 11:30
    await expect(
      scheduler.bookAppointment({
        customerId: otherCust.id,
        customerPhone: otherCust.phone,
        visitType: 'in_office',
        service: 'Office Follow-up',
        startTime: '2026-09-07T11:15:00.000Z',
        endTime: '2026-09-07T12:00:00.000Z',
      })
    ).rejects.toThrow('travel buffer');

    // Booking at 11:30 succeeds
    const apptAfter = await scheduler.bookAppointment({
      customerId: otherCust.id,
      customerPhone: otherCust.phone,
      visitType: 'in_office',
      service: 'Office Follow-up',
      startTime: '2026-09-07T11:30:00.000Z',
      endTime: '2026-09-07T12:30:00.000Z',
    });
    expect(apptAfter.status).toBe('booked');
  });

  it('reschedules and cancels appointments correctly', async () => {
    const cust = db.customers.findOrCreate('whatsapp:+15550001005', 'Eve');

    const appt = await scheduler.bookAppointment({
      customerId: cust.id,
      customerPhone: cust.phone,
      visitType: 'in_office',
      service: 'Physical Exam',
      startTime: '2026-09-07T14:00:00.000Z',
      endTime: '2026-09-07T15:00:00.000Z',
    });

    // Reschedule to 16:00
    const resched = await scheduler.rescheduleAppointment({
      appointmentId: appt.id,
      newStartTime: '2026-09-07T16:00:00.000Z',
      newEndTime: '2026-09-07T17:00:00.000Z',
    });

    expect(resched.status).toBe('rescheduled');
    expect(resched.start_time).toBe('2026-09-07T16:00:00.000Z');

    // Verify 14:00 is now free to book again
    const replacementAppt = await scheduler.bookAppointment({
      customerId: cust.id,
      customerPhone: cust.phone,
      visitType: 'in_office',
      service: 'Follow Up',
      startTime: '2026-09-07T14:00:00.000Z',
      endTime: '2026-09-07T15:00:00.000Z',
    });
    expect(replacementAppt.status).toBe('booked');

    // Cancel the rescheduled appointment
    const cancelled = await scheduler.cancelAppointment(resched.id, 'Patient changed plans');
    expect(cancelled.status).toBe('cancelled');

    // Calendar event is deleted
    const calEvents = await calendar.listEvents(
      new Date('2026-09-07T15:30:00.000Z'),
      new Date('2026-09-07T17:30:00.000Z')
    );
    expect(calEvents.length).toBe(0);
  });
});
