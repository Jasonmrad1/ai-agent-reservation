import { it, expect } from 'vitest';
import { createDatabaseContext } from '../src/db/index.js';
it('selects the newest workflow even when timestamps are equal', () => {
  const db=createDatabaseContext(':memory:'); const c=db.customers.findOrCreate('+96171000111'); const v=db.conversations.getOrCreateActive(c.id);
  db.workflows.create({customer_id:c.id,conversation_id:v.id,date:'2026-09-14',time:'10:00'});
  const latest=db.workflows.create({customer_id:c.id,conversation_id:v.id,date:'2026-09-15',time:'11:00'});
  db.appDb.db.exec("UPDATE pending_booking_workflows SET updated_at = '2026-09-01T00:00:00.000Z'");
  expect(db.workflows.findActiveByCustomerId(c.id)?.id).toBe(latest.id);
});
