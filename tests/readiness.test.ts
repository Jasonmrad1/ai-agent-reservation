import {it,expect} from 'vitest';import request from 'supertest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it('reports offline simulator readiness without requiring paid credentials',async()=>{
 const a=createApp({config:{...config,mode:'simulator',databaseUrl:':memory:'}});const r=await request(a.app).get('/ready');expect(r.status).toBe(200);expect(r.body.ready).toBe(true);
});
it('keeps legacy data out of live readiness and protects detailed diagnostics',async()=>{
 const a=createApp({config:{...config,mode:'clinic',databaseUrl:':memory:'}});a.db.settings.set('timezone_storage_version','legacy-review');
 expect((await request(a.app).get('/ready')).status).toBe(503);
 expect((await request(a.app).get('/admin/api/readiness')).status).toBe(401);
 const r=await request(a.app).get('/admin/api/readiness').set('Authorization','Bearer '+config.adminSessionSecret);expect(r.body.blockers).toContain('Legacy appointment times require review');
});
