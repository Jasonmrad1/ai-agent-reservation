import { it, expect } from 'vitest';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
function setup() {
  const db=createDatabaseContext(':memory:'); const c=db.customers.findOrCreate('+96171000111');
  const scheduler=new SchedulingEngine({db,calendar:new InMemoryCalendarProvider()});
  const book=(start:string,end?:string)=>scheduler.bookAppointment({customerId:c.id,customerPhone:c.phone,visitType:'in_office',service:'Consultation',startTime:start,endTime:end});
  return {db,c,scheduler,book};
}
it('rejects closed days', async () => { await expect(setup().book('2026-09-06T10:00:00Z')).rejects.toThrow(/closed|working hours/i); });
it('rejects past appointments', async () => { await expect(setup().book('2020-01-06T10:00:00Z')).rejects.toThrow(/past|future/i); });
it('rejects zero and negative durations', async () => {
  await expect(setup().book('2026-09-14T10:00:00Z','2026-09-14T10:00:00Z')).rejects.toThrow(/duration|end/i);
  await expect(setup().book('2026-09-14T10:00:00Z','2026-09-14T09:00:00Z')).rejects.toThrow(/duration|end/i);
});
it('rejects past-date availability', async () => { expect(await setup().scheduler.getAvailableSlots('2020-01-06','in_office')).toEqual([]); });
