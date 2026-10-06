import {it,expect} from 'vitest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import {clinicIso} from './clinic-time.js';
it('does not confirm a location-pin booking when the selected slot became occupied',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const c=a.db.customers.findOrCreate('+96171000111');const v=a.db.conversations.getOrCreateActive(c.id);
 const wf=a.db.workflows.create({customer_id:c.id,conversation_id:v.id,state:'awaiting_address',visit_type:'home_visit',date:'2026-09-14',time:'10:00'});
 await a.calendar.createEvent({summary:'Busy',start:new Date(clinicIso('2026-09-14T10:00:00Z')),end:new Date(clinicIso('2026-09-14T11:00:00Z'))});
 const r=await a.agent.processMessage({customer:c,conversation:v,incomingText:'📍 Shared Location: Beirut | Maps: https://maps.google.com/',db:a.db});
 expect(String(r)).not.toContain('has been confirmed');expect(a.db.workflows.findById(wf.id)?.state).not.toBe('booked');expect(a.db.appointments.findUpcomingByCustomerId(c.id)).toHaveLength(0);
});
