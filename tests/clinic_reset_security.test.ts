import {it,expect} from 'vitest';import request from 'supertest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it('does not accept destructive simulator reset commands on the clinic webhook',async()=>{
 const a=createApp({config:{...config,nodeEnv:'development',mode:'clinic',databaseUrl:':memory:'}});
 const c=a.db.customers.findOrCreate('+96171000888');const appt=a.db.appointments.create({customer_id:c.id,visit_type:'in_office',service:'Consultation',price:100,start_time:'2026-09-14T07:00:00Z',end_time:'2026-09-14T08:00:00Z',status:'booked'} as any);
 await request(a.app).post('/api/webhook/whatsapp').send({From:c.phone,Body:'#reset',MessageSid:'SM_NO_RESET'});
 expect(a.db.appointments.findById(appt.id)?.status).toBe('booked');
});
