import { it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import {validateConfig} from '../src/config/index.js';
it('requires persistent storage and canonical HTTPS URLs for clinic production',()=>{
 const cfg={...config,nodeEnv:'production',mode:'clinic',adminSessionSecret:'x'.repeat(40),databaseUrl:':memory:',twilioAccountSid:'account',twilioAuthToken:'token',twilioWhatsappNumber:'whatsapp:+96171000123',adminWhatsappNumber:'whatsapp:+96171000124',geminiApiKey:'key',googleCalendarClientId:'id',googleCalendarClientSecret:'secret'} as any;
 expect(()=>validateConfig(cfg)).toThrow(/persistent|HTTPS/);
 cfg.databaseUrl='data/clinic.sqlite';cfg.publicBaseUrl='http://example.com';expect(()=>validateConfig(cfg)).toThrow(/HTTPS/);
 cfg.publicBaseUrl='https://clinic.example';cfg.googleCalendarRedirectUri='https://other.example/admin/oauth2callback';expect(()=>validateConfig(cfg)).toThrow(/callback/);
});

it('refuses incomplete production clinic configuration rather than using mocks', () => {
  expect(() => createApp({ config: { ...config, nodeEnv: 'production', databaseUrl: ':memory:' } })).toThrow(/configuration/i);
});

it('allows explicit offline simulator mode without paid credentials', () => {
  const instance = createApp({ config: { ...config, nodeEnv: 'production', mode: 'simulator', adminSessionSecret: 'a'.repeat(40), databaseUrl: ':memory:' } as any });
  expect(instance.gateway.constructor.name).toBe('MockWhatsAppGateway');
});
