import {it,expect} from 'vitest';
import {GoogleCalendarProvider,InMemoryCalendarProvider} from '../src/calendar/provider.js';
import {createDatabaseContext} from '../src/db/index.js';
import {SchedulingEngine} from '../src/calendar/scheduler.js';
import {clinicIso} from './clinic-time.js';
it('fails closed when Google Calendar is disconnected',async()=>{
 const p=new GoogleCalendarProvider({calendarId:'primary'});
 await expect(p.listEvents(new Date(),new Date())).rejects.toThrow(/connect/i);
 await expect(p.createEvent({summary:'test',start:new Date(),end:new Date()})).rejects.toThrow(/connect/i);
});
it('keeps appointment unchanged when remote move or cancellation fails',async()=>{
 const db=createDatabaseContext(':memory:');const calendar=new InMemoryCalendarProvider();const s=new SchedulingEngine({db,calendar});const c=db.customers.findOrCreate('+96171000111');
 const a=await s.bookAppointment({customerId:c.id,customerPhone:c.phone,visitType:'in_office',service:'Consultation',startTime:clinicIso('2026-09-14T10:00:00Z')});
 calendar.updateEvent=async()=>{throw new Error('Calendar outage');};calendar.deleteEvent=async()=>{throw new Error('Calendar outage');};
 await expect(s.rescheduleAppointment({appointmentId:a.id,newStartTime:clinicIso('2026-09-14T12:00:00Z')})).rejects.toThrow('Calendar outage');
 expect(db.appointments.findById(a.id)?.start_time).toBe(a.start_time);
 await expect(s.cancelAppointment(a.id)).rejects.toThrow('Calendar outage');expect(db.appointments.findById(a.id)?.status).toBe('booked');
});
