import { it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
const make = () => createApp({ config: { ...config, nodeEnv: 'development', databaseUrl: ':memory:', adminSessionSecret: 'audit-secret' } });
it('reports the same injected Google configuration used by the provider',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',googleCalendarClientId:'configured-id',googleCalendarClientSecret:'configured-secret',googleCalendarId:'clinic-calendar'}});
 const r=await request(a.app).get('/admin/api/google-calendar/status').set('Authorization','Bearer '+config.adminSessionSecret);
 expect(r.body.configured).toBe(true);expect(r.body.calendarId).toBe('clinic-calendar');
});
it('preserves a zero buffer and rejects invalid values without mutating settings',async()=>{
 const a=make();const api=request(a.app);
 expect((await api.post('/admin/api/settings').set('Authorization','Bearer audit-secret').send({home_visit_buffer_minutes:0})).body.home_visit_buffer_minutes).toBe(0);
 expect((await api.get('/admin/api/settings').set('Authorization','Bearer audit-secret')).body.home_visit_buffer_minutes).toBe(0);
 for(const value of ['abc',-1,1.5,481])expect((await api.post('/admin/api/settings').set('Authorization','Bearer audit-secret').send({home_visit_buffer_minutes:value})).status).toBe(400);
 expect(a.db.settings.get('home_visit_buffer_minutes')).toBe('0');
});

it('does not expose refresh tokens through settings', async () => {
  const a=make(); a.db.settings.set('google_calendar_refresh_token','sentinel');
  const r=await request(a.app).get('/admin/api/settings').set('Authorization','Bearer audit-secret');
  expect(r.body.all?.google_calendar_refresh_token).toBeUndefined();
});
it('rejects query credentials and cannot inject script through dashboard URLs', async () => {
  const a=make();
  expect((await request(a.app).get('/admin/api/settings?key=audit-secret')).status).toBe(401);
  const r=await request(a.app).get('/admin/dashboard').query({key:'</script><script>window.pwned=1</script>'});
  expect(r.text).not.toContain('<script>window.pwned=1</script>');
});
it('rejects OAuth callbacks without a session-bound state', async () => {
  const r=await request(make().app).get('/admin/oauth2callback?code=fake&state=audit-secret');
  expect([401,403]).toContain(r.status);
});
it('uses an expiring session and requires CSRF for cookie-authenticated writes', async () => {
  const a=make(); const client=request.agent(a.app);
  const login=await client.post('/admin/login').send({secret:'audit-secret'});
  expect(login.status).toBe(200);
  expect(login.headers['set-cookie']?.join('')).toContain('HttpOnly');
  const session=await client.get('/admin/api/session');
  expect(session.status).toBe(200);
  expect((await client.post('/admin/api/settings').send({home_visit_buffer_minutes:20})).status).toBe(403);
  expect((await client.post('/admin/api/settings').set('x-csrf-token',session.body.csrfToken).send({home_visit_buffer_minutes:20})).status).toBe(200);
});
