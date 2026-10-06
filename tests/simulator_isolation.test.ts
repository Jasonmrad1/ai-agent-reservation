import { it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';

it('requires admin authentication for simulator access', async () => {
  const instance = createApp({ config: { ...config, databaseUrl: ':memory:', adminSessionSecret: 'test-secret' } });
  expect((await request(instance.app).get('/api/simulator/history?phone=+96171000111')).status).toBe(401);
});

it('uses isolated records and never sends clinic notifications', async () => {
  const instance = createApp({ config: { ...config, databaseUrl: ':memory:', adminSessionSecret: 'test-secret' } });
  const patient = instance.db.customers.findOrCreate('+96171000111', 'Real Patient');
  const result = await request(instance.app).post('/api/simulator/message')
    .set('Authorization', 'Bearer test-secret')
    .send({ phone: patient.phone, text: 'human', name: 'Sandbox Patient' });
  expect(result.status).toBe(200);
  expect(instance.db.customers.findById(patient.id)?.name).toBe('Real Patient');
  expect(instance.db.conversations.findActiveByCustomerId(patient.id)).toBeNull();
  expect((instance.gateway as any).sentMessages).toHaveLength(0);
});
