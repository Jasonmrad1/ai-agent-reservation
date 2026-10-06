import {it,expect} from 'vitest';import request from 'supertest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it('rejects zero duration and invalid visit types on manual bookings',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});const payload={phone:'+96171000181',date:'2026-09-14',time:'10:00',service:'Consultation'};
 for(const extra of [{duration_minutes:0},{visit_type:'unknown'},{override:'false'},{price:-1}])expect((await request(a.app).post('/admin/api/appointments/manual').set('Authorization','Bearer '+config.adminSessionSecret).send({...payload,...extra})).status).toBe(400);
});
