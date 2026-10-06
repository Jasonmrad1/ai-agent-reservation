import { clinicIso } from './clinic-time.js';
import { it, expect } from 'vitest';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
it('uses the weekly travel buffer in booking shift validation', async () => {
  const db=createDatabaseContext(':memory:'); const c=db.customers.findOrCreate('+96171000111');
  db.settings.set('home_visit_buffer_minutes_week_2026-09-14','90');
  const scheduler=new SchedulingEngine({db,calendar:new InMemoryCalendarProvider()});
  expect(await scheduler.getAvailableSlots('2026-09-14','home_visit')).not.toContain('15:30');
  await expect(scheduler.bookAppointment({customerId:c.id,customerPhone:c.phone,visitType:'home_visit',address:'Beirut, building 10',service:'Home Visit',startTime:clinicIso('2026-09-14T15:30:00Z')})).rejects.toThrow(/working hours|travel buffer/);
});
it('requires travel time after an external event before a home visit', async () => {
  const db=createDatabaseContext(':memory:'); const calendar=new InMemoryCalendarProvider(); const c=db.customers.findOrCreate('+96171000111');
  await calendar.createEvent({summary:'Personal',start:new Date(clinicIso('2026-09-14T09:00:00Z')),end:new Date(clinicIso('2026-09-14T10:00:00Z'))});
  const scheduler=new SchedulingEngine({db,calendar});
  expect(await scheduler.getAvailableSlots('2026-09-14','home_visit')).not.toContain('10:00');
  await expect(scheduler.bookAppointment({customerId:c.id,customerPhone:c.phone,visitType:'home_visit',address:'Beirut, building 10',service:'Home Visit',startTime:clinicIso('2026-09-14T10:00:00Z')})).rejects.toThrow(/conflict|travel/);
});
