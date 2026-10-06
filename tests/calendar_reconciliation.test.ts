import {it,expect} from 'vitest';
import {createDatabaseContext} from '../src/db/index.js';
import {InMemoryCalendarProvider} from '../src/calendar/provider.js';
import {SchedulingEngine} from '../src/calendar/scheduler.js';
import {clinicIso} from './clinic-time.js';
it('blocks a move while cancellation has an uncertain remote outcome',async()=>{
 const db=createDatabaseContext(':memory:');const cal=new InMemoryCalendarProvider();const s=new SchedulingEngine({db,calendar:cal});const c=db.customers.findOrCreate('+96171000123');
 const a=await s.bookAppointment({customerId:c.id,customerPhone:c.phone,visitType:'in_office',service:'Consultation',startTime:clinicIso('2026-09-14T10:00:00Z')});
 cal.deleteEvent=async()=>{throw new Error('Remote timeout');};await expect(s.cancelAppointment(a.id)).rejects.toThrow();
 await expect(s.rescheduleAppointment({appointmentId:a.id,newStartTime:clinicIso('2026-09-14T12:00:00Z')})).rejects.toThrow(/in progress/);
});
it('retains an uncertain calendar write and recovers it without duplicating the event',async()=>{
 const db=createDatabaseContext(':memory:'); const calendar=new InMemoryCalendarProvider();const s=new SchedulingEngine({db,calendar});const c=db.customers.findOrCreate('+96171000111');
 const original=db.appointments.create.bind(db.appointments);db.appointments.create=()=>{throw new Error('Disk unavailable');};
 await expect(s.bookAppointment({operationId:'inbound-1',customerId:c.id,customerPhone:c.phone,visitType:'in_office',service:'Consultation',startTime:clinicIso('2026-09-14T10:00:00Z')})).rejects.toThrow();
 expect(db.appDb.db.prepare('SELECT id FROM scheduling_reservations').all()).toHaveLength(1);
 db.appointments.create=original;
 await (s as any).reconcileCalendarOperations();
 expect(db.appointments.findUpcomingByCustomerId(c.id)).toHaveLength(1);
 expect(await calendar.listEvents(new Date('2026-09-14'),new Date('2026-09-15'))).toHaveLength(1);
 expect(db.appDb.db.prepare('SELECT id FROM scheduling_reservations').all()).toHaveLength(0);
});
