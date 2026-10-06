import {it,expect} from 'vitest';import {createDatabaseContext} from '../src/db/index.js';import {InMemoryCalendarProvider} from '../src/calendar/provider.js';import {SchedulingEngine} from '../src/calendar/scheduler.js';import {clinicIso} from './clinic-time.js';
const setup=()=>{const db=createDatabaseContext(':memory:');const calendar=new InMemoryCalendarProvider();const scheduler=new SchedulingEngine({db,calendar});const c=db.customers.findOrCreate('+96171000151');return {db,calendar,scheduler,c};};
it('detects return-travel conflicts after a weekly hours change',()=>{
 const {scheduler,db,c}=setup();db.appointments.create({customer_id:c.id,visit_type:'home_visit',service:'Consultation',price:100,start_time:clinicIso('2026-09-14T16:00:00Z'),end_time:clinicIso('2026-09-14T17:00:00Z'),status:'booked'} as any);
 expect(scheduler.getConflictingAppointmentsForWeeklyChange(1,[{start_time:'09:00',end_time:'17:00'}],true)).toHaveLength(1);
});
