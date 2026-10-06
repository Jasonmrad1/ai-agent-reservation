import {it,expect} from 'vitest';import {createDatabaseContext} from '../src/db/index.js';import {InMemoryCalendarProvider} from '../src/calendar/provider.js';import {SchedulingEngine} from '../src/calendar/scheduler.js';import {clinicIso} from './clinic-time.js';
const setup=()=>{const db=createDatabaseContext(':memory:');const calendar=new InMemoryCalendarProvider();const scheduler=new SchedulingEngine({db,calendar});const c=db.customers.findOrCreate('+96171000151');return {db,calendar,scheduler,c};};
it('rejects invalid prices and unknown patients before any calendar write',async()=>{
 const {scheduler,calendar,c}=setup();const p={customerId:c.id,customerPhone:c.phone,visitType:'in_office' as const,service:'Consultation',startTime:clinicIso('2026-09-14T10:00:00Z')};
 for(const price of [-1,NaN,Infinity])await expect(scheduler.bookAppointment({...p,price})).rejects.toThrow(/price/);
 await expect(scheduler.bookAppointment({...p,customerId:'missing'})).rejects.toThrow(/patient|customer/i);
 expect(await calendar.listEvents(new Date('2026-09-14'),new Date('2026-09-15'))).toHaveLength(0);
});
it('does not reopen cancelled or completed appointments by rescheduling',async()=>{
 const {scheduler,db,c}=setup();const a=await scheduler.bookAppointment({customerId:c.id,customerPhone:c.phone,visitType:'in_office',service:'Consultation',startTime:clinicIso('2026-09-14T10:00:00Z')});db.appointments.updateStatus(a.id,'completed');
 await expect(scheduler.rescheduleAppointment({appointmentId:a.id,newStartTime:clinicIso('2026-09-14T12:00:00Z')})).rejects.toThrow(/active/);
});
