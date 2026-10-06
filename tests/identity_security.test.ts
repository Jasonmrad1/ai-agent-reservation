import { it, expect } from 'vitest';
import { createDatabaseContext } from '../src/db/index.js';
import { normalizePhone } from '../src/db/repositories/customer.repo.js';
it('does not match partial phone numbers to another patient', () => {
  const db=createDatabaseContext(':memory:'); db.customers.findOrCreate('+96171000111');
  expect(db.customers.findByPhone('+7100011')).toBeNull();
  expect(db.customers.findByPhone('111')).toBeNull();
});
it('normalizes Lebanese mobile and international aliases consistently', () => {
  expect(normalizePhone('03 123 456')).toBe('whatsapp:+9613123456');
  expect(normalizePhone('3 123 456')).toBe('whatsapp:+9613123456');
  expect(normalizePhone('00961 71 000 111')).toBe('whatsapp:+96171000111');
});
