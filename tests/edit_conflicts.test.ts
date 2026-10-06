import {it,expect} from 'vitest';import request from 'supertest';
import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import {clinicIso} from './clinic-time.js';
it('checks external calendar conflicts during rescheduling and admin edits',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const c=a.db.customers.findOrCreate('+96171000111');const appt=await a.scheduler.bookAppointment({customerId:c.id,customerPhone:c.phone,visitType:'in_office',service:'Consultation',startTime:clinicIso('2026-09-14T10:00:00Z')});
 await a.calendar.createEvent({summary:'Other meeting',start:new Date(clinicIso('2026-09-14T12:00:00Z')),end:new Date(clinicIso('2026-09-14T13:00:00Z'))});
 await expect(a.scheduler.rescheduleAppointment({appointmentId:appt.id,newStartTime:clinicIso('2026-09-14T12:00:00Z')})).rejects.toThrow(/conflict/i);
 const response=await request(a.app).patch('/admin/api/appointments/'+appt.id).set('Authorization','Bearer '+config.adminSessionSecret).send({start_time:clinicIso('2026-09-14T12:00:00Z'),end_time:clinicIso('2026-09-14T13:00:00Z')});
 expect(response.status).toBe(400);expect(a.db.appointments.findById(appt.id)?.start_time).toBe(appt.start_time);
});
