import {it,expect} from 'vitest';import {createDatabaseContext} from '../src/db/index.js';import {applyReviewedTimes} from '../src/db/legacy-times.js';
it('requires every appointment to be reviewed and applies UTC decisions atomically',()=>{
 const d=createDatabaseContext(':memory:');const c=d.customers.findOrCreate('+96171000134');const a=d.appointments.create({customer_id:c.id,visit_type:'in_office',service:'Consultation',price:100,start_time:'2026-09-14T10:00:00.000Z',end_time:'2026-09-14T11:00:00.000Z',status:'booked',google_event_id:'event123'} as any);d.settings.set('timezone_storage_version','legacy-review');
 expect(()=>applyReviewedTimes(d,[])).toThrow(/every/);expect(d.settings.get('timezone_storage_version')).toBe('legacy-review');
 applyReviewedTimes(d,[{id:a.id,start_time:'2026-09-14T07:00:00.000Z',end_time:'2026-09-14T08:00:00.000Z',google_event_id:'event123'}]);expect(d.appointments.findById(a.id)?.start_time).toBe('2026-09-14T07:00:00.000Z');expect(d.settings.get('timezone_storage_version')).toBe('utc-v1');
});
