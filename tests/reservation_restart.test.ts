import {it,expect} from 'vitest';import {createDatabaseContext} from '../src/db/index.js';import {InMemoryCalendarProvider} from '../src/calendar/provider.js';import {SchedulingEngine} from '../src/calendar/scheduler.js';
it('releases only pre-journal reservations after a process restart',()=>{
 const db=createDatabaseContext(':memory:');const s=new SchedulingEngine({db,calendar:new InMemoryCalendarProvider()});const c=db.customers.findOrCreate('+96171000199');
 for(const id of ['orphan','uncertain'])db.appDb.db.prepare('INSERT INTO scheduling_reservations VALUES (?,?,?,?,?,?,?)').run(id,c.id,null,'in_office','2026-09-14T07:00:00Z','2026-09-14T08:00:00Z','2026-09-01T00:00:00Z');
 db.appDb.db.prepare('INSERT INTO calendar_operations(id,kind,payload,reservation_id,created_at) VALUES (?,?,?,?,?)').run('op','book','{}','uncertain','2026-09-01T00:00:00Z');
 s.recoverInterruptedReservations();expect(db.appDb.db.prepare('SELECT id FROM scheduling_reservations').all().map(r=>r.id)).toEqual(['uncertain']);
});
