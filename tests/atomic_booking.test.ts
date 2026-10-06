import { it, expect } from 'vitest';
import { createDatabaseContext } from '../src/db/index.js';
import { InMemoryCalendarProvider } from '../src/calendar/provider.js';
import { SchedulingEngine } from '../src/calendar/scheduler.js';
it('atomically reserves a slot before asynchronous calendar calls', async () => {
  const db=createDatabaseContext(':memory:'); const calendar=new InMemoryCalendarProvider();
  const first=new SchedulingEngine({db,calendar}); const second=new SchedulingEngine({db,calendar});
  const book=(scheduler:SchedulingEngine,phone:string)=>{const c=db.customers.findOrCreate(phone);return scheduler.bookAppointment({customerId:c.id,customerPhone:c.phone,visitType:'in_office',service:'Consultation',startTime:'2026-09-14T10:00:00Z'});};
  const results=await Promise.allSettled([book(first,'+96171000111'),book(second,'+96171000222')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(db.appointments.listUpcoming(10)).toHaveLength(1);
});
