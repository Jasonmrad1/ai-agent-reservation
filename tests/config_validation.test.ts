import { it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';

it('refuses incomplete production clinic configuration rather than using mocks', () => {
  expect(() => createApp({ config: { ...config, nodeEnv: 'production', databaseUrl: ':memory:' } })).toThrow(/configuration/i);
});

it('allows explicit offline simulator mode without paid credentials', () => {
  const instance = createApp({ config: { ...config, nodeEnv: 'production', mode: 'simulator', adminSessionSecret: 'a'.repeat(40), databaseUrl: ':memory:' } as any });
  expect(instance.gateway.constructor.name).toBe('MockWhatsAppGateway');
});
