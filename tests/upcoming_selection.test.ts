import { it, expect, vi } from 'vitest';
import { createDatabaseContext } from '../src/db/index.js';
it('filters historical visits before applying upcoming limits', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
  try {
    const db=createDatabaseContext(':memory:'); const c=db.customers.findOrCreate('+96171000111');
    const add=(start:string,status:any='booked')=>db.appointments.create({customer_id:c.id,visit_type:'in_office',service:'Consultation',price:120,start_time:start,end_time:new Date(new Date(start).getTime()+3600000).toISOString(),status});
    add('2025-01-01T10:00:00Z'); add('2026-09-02T10:00:00Z','cancelled'); const future=add('2026-09-03T10:00:00Z');
    expect(db.appointments.listUpcoming(1)[0]?.id).toBe(future.id);
    expect(db.appointments.findLatestActiveByCustomerId(c.id)?.id).toBe(future.id);
    expect(db.appointments.findUpcomingByCustomerId(c.id)).toHaveLength(1);
  } finally {vi.useRealTimers();}
});
