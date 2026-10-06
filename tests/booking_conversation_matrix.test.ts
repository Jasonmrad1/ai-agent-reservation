import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {config} from '../src/config/index.js';
import {clinicIso} from './clinic-time.js';

let number=0;
async function scenario(run:(f:ReturnType<typeof fixture>)=>Promise<void>){
 const f=fixture();try{await run(f);await f.consistent();}finally{f.a.db.appDb.close();f.a.simulator.db.appDb.close();}
}
function fixture(){
 const a=createApp({config:{...config,databaseUrl:':memory:'}});
 const phone=`+9617101${String(++number).padStart(4,'0')}`;let turn=0;
 const send=async(text:string,extra:Record<string,string>={})=>{
  const result=await request(a.app).post('/api/webhook/whatsapp').send({From:phone,Body:text,MessageSid:`SM_MATRIX_${number}_${++turn}`,...extra});
  expect(result.status).toBe(200);
  const customer=a.db.customers.findByPhone(phone)!;
  const messages=(a.gateway as any).sentMessages.filter((m:any)=>m.to===customer.phone);
  return messages.at(-1)?.body as string || '';
 };
 const visits=()=>a.db.appointments.findUpcomingByCustomerId(a.db.customers.findByPhone(phone)!.id);
 const consistent=async()=>{
  const rows=a.db.appDb.db.prepare("SELECT * FROM appointments WHERE status IN ('booked','confirmed','rescheduled')").all() as any[];
  const events=await a.calendar.listEvents(new Date('2026-09-01'),new Date('2027-01-01'));
  expect(events).toHaveLength(rows.length);
  for(const row of rows){const event=events.find(e=>e.id===row.google_event_id)!;expect(event).toBeDefined();expect(event.start.toISOString()).toBe(row.start_time);expect(event.end.toISOString()).toBe(row.end_time);}
 };
 return {a,phone,send,visits,consistent};
}

describe('Offline HTTP booking conversation matrix',()=>{
 it.each(['September 14 at 9am','September 14 at 11:30am','September 15 at 2pm','October 12 at 10am'])('books exactly the requested clinic slot: %s',slot=>scenario(async f=>{
  expect(await f.send(`Book in clinic ${slot}`)).toMatch(/confirmed/i);
  expect(f.visits()).toHaveLength(1);expect(f.visits()[0].visit_type).toBe('in_office');
  const expected:Record<string,string>={'September 14 at 9am':'2026-09-14T09:00:00Z','September 14 at 11:30am':'2026-09-14T11:30:00Z','September 15 at 2pm':'2026-09-15T14:00:00Z','October 12 at 10am':'2026-10-12T10:00:00Z'};
  expect(f.visits()[0].start_time).toBe(clinicIso(expected[slot]));
 }));
 it.each(['September 13 at 11am','September 14 at 7am','September 14 at 6pm','August 31 at 11am'])('rejects a closed or past slot: %s',slot=>scenario(async f=>{
  const reply=await f.send(`Book in clinic ${slot}`);expect(reply).not.toMatch(/has been confirmed/i);expect(f.visits()).toHaveLength(0);
 }));
 it('collects home visit address from a separate location message',()=>scenario(async f=>{
  expect(await f.send('Book a home visit September 14 at 11am')).toMatch(/address|location/i);expect(f.visits()).toHaveLength(0);
  expect(await f.send('',{Latitude:'33.8938',Longitude:'35.5018',Label:'Beirut building 20'})).toMatch(/confirmed/i);
  expect(f.visits()).toHaveLength(1);expect(f.visits()[0].address).toContain('Beirut building 20');expect(f.visits()[0].visit_type).toBe('home_visit');
 }));
 it('moves a clinic visit and then cancels it',()=>scenario(async f=>{
  await f.send('Book in clinic September 14 at 11am');const id=f.visits()[0].id;
  expect(await f.send('Move my appointment to September 15 at 2pm')).toMatch(/rescheduled/i);
  expect(f.visits()[0].id).toBe(id);expect(f.visits()[0].start_time).toBe(clinicIso('2026-09-15T14:00:00Z'));
  expect(await f.send('cancel my appointment')).toMatch(/cancelled/i);expect(f.visits()).toHaveLength(0);
  expect(f.a.db.appointments.findById(id)?.status).toBe('cancelled');
 }));
 it('does not silently move the original when adding another clinic visit',()=>scenario(async f=>{
  await f.send('Book in clinic September 14 at 11am');const original=f.visits()[0];
  await f.send('Book another appointment in clinic September 15 at 2pm');
  expect(f.visits()).toHaveLength(2);expect(f.a.db.appointments.findById(original.id)?.start_time).toBe(original.start_time);
  expect(await f.send('cancel my appointment')).toMatch(/which appointment/i);
  expect(f.visits()).toHaveLength(2);expect(await f.send('2')).toMatch(/cancelled/i);expect(f.visits()).toHaveLength(1);
 }));
 it('asks for missing visit type before saving a visit',()=>scenario(async f=>{
  await f.send('Book September 14 at 11am');expect(f.visits()).toHaveLength(0);
  expect(await f.send('in clinic')).toMatch(/confirmed/i);expect(f.visits()).toHaveLength(1);
 }));
 it('confirms the booked appointment without creating another one',()=>scenario(async f=>{
  await f.send('Book in clinic September 14 at 11am');const id=f.visits()[0].id;
  expect(await f.send('YES')).toMatch(/confirmed/i);expect(f.visits()).toHaveLength(1);expect(f.visits()[0].id).toBe(id);expect(f.visits()[0].status).toBe('confirmed');
 }));
 it('deduplicates a repeated webhook and keeps one patient confirmation',()=>scenario(async f=>{
  const payload={From:f.phone,Body:'Book in clinic September 14 at 11am',MessageSid:'SM_REPEAT_MATRIX'};
  await request(f.a.app).post('/api/webhook/whatsapp').send(payload);await request(f.a.app).post('/api/webhook/whatsapp').send(payload);
  expect(f.visits()).toHaveLength(1);
  const c=f.a.db.customers.findByPhone(f.phone)!;expect((f.a.gateway as any).sentMessages.filter((m:any)=>m.to===c.phone)).toHaveLength(1);
 }));
 it('keeps the original visit when a reschedule collides with another patient',()=>scenario(async f=>{
  await f.send('Book in clinic September 14 at 11am');const original=f.visits()[0];
  const other=f.a.db.customers.findOrCreate('+96171010992');
  await f.a.scheduler.bookAppointment({customerId:other.id,customerPhone:other.phone,visitType:'in_office',service:'Consultation',startTime:clinicIso('2026-09-15T14:00:00Z')});
  const reply=await f.send('Move my appointment to September 15 at 2pm');expect(reply).not.toMatch(/has been rescheduled/i);
  expect(f.visits()[0].start_time).toBe(original.start_time);expect(f.visits()[0].status).toBe('booked');
 }));
 it('allows only one booking when ten patients concurrently request the same slot',()=>scenario(async f=>{
  const results=await Promise.all(Array.from({length:10},(_,i)=>request(f.a.app).post('/api/webhook/whatsapp').send({From:`+9617102${String(i).padStart(4,'0')}`,Body:'Book in clinic September 14 at 11am',MessageSid:`SM_RACE_${i}`})));
  expect(results.every(r=>r.status===200)).toBe(true);
  expect(f.a.db.appDb.db.prepare('SELECT * FROM appointments').all()).toHaveLength(1);
  expect((f.a.gateway as any).sentMessages.filter((m:any)=>/Your appointment has been confirmed/i.test(m.body))).toHaveLength(1);
  expect(f.a.db.appDb.db.prepare("SELECT * FROM inbound_jobs WHERE status!='done'").all()).toHaveLength(0);
 }));
 it('lets the patient switch from home visit to clinic before supplying an address',()=>scenario(async f=>{
  await f.send('Book a home visit September 14 at 11am');expect(f.visits()).toHaveLength(0);
  expect(await f.send('in clinic instead')).toMatch(/confirmed/i);
  expect(f.visits()).toHaveLength(1);expect(f.visits()[0].visit_type).toBe('in_office');expect(f.visits()[0].address).toBeNull();
 }));
 it('does not treat an acknowledgement as the requested home address',()=>scenario(async f=>{
  await f.send('Book a home visit September 14 at 11am');
  await f.send('thank you');expect(f.visits()).toHaveLength(0);
  expect(f.a.db.workflows.findActiveByCustomerId(f.a.db.customers.findByPhone(f.phone)!.id)?.state).toBe('awaiting_address');
  expect(await f.send('My address is Beirut, Hamra, building 20, floor 2')).toMatch(/confirmed/i);
  expect(f.visits()[0].address).toBe('Beirut, Hamra, building 20, floor 2');
 }));
 it('uses a changed home-visit slot when the location arrives later',()=>scenario(async f=>{
  await f.send('Book a home visit September 14 at 11am');await f.send('September 15 at 2pm instead');
  expect(f.visits()).toHaveLength(0);
  expect(await f.send('',{Latitude:'33.8938',Longitude:'35.5018',Label:'Hamra building 20'})).toMatch(/confirmed/i);
  expect(f.visits()).toHaveLength(1);expect(f.visits()[0].start_time).toBe(clinicIso('2026-09-15T14:00:00Z'));
 }));
 it('deduplicates twenty concurrent deliveries of the same booking webhook',()=>scenario(async f=>{
  const payload={From:f.phone,Body:'Book in clinic September 14 at 11am',MessageSid:'SM_REPEAT_CONCURRENT'};
  const results=await Promise.all(Array.from({length:20},()=>request(f.a.app).post('/api/webhook/whatsapp').send(payload)));
  expect(results.every(r=>r.status===200)).toBe(true);expect(f.visits()).toHaveLength(1);
  const c=f.a.db.customers.findByPhone(f.phone)!;expect((f.a.gateway as any).sentMessages.filter((m:any)=>m.to===c.phone)).toHaveLength(1);
 }));
 it('allows booking again after cancelling and releases the original slot',()=>scenario(async f=>{
  await f.send('Book in clinic September 14 at 11am');const cancelled=f.visits()[0].id;
  await f.send('CANCEL');expect(f.visits()).toHaveLength(0);
  expect(await f.send('Book in clinic September 14 at 11am')).toMatch(/confirmed/i);
  expect(f.visits()).toHaveLength(1);expect(f.visits()[0].id).not.toBe(cancelled);expect(f.a.db.appointments.findById(cancelled)?.status).toBe('cancelled');
 }));
 it('does not claim success when cancelling again after cancellation',()=>scenario(async f=>{
  await f.send('Book in clinic September 14 at 11am');await f.send('cancel my appointment');
  const reply=await f.send('cancel my appointment');expect(reply).not.toMatch(/has been cancelled|has been confirmed/i);
  expect(f.visits()).toHaveLength(0);expect(f.a.db.appDb.db.prepare('SELECT * FROM appointments').all()).toHaveLength(1);
 }));
 it('never confirms a booking after the calendar creation fails',()=>scenario(async f=>{
  vi.spyOn(f.a.calendar,'createEvent').mockRejectedValueOnce(new Error('Calendar temporarily unavailable'));
  const reply=await f.send('Book in clinic September 14 at 11am');
  expect(reply).not.toMatch(/has been confirmed/i);expect(f.visits()).toHaveLength(0);
  expect(f.a.db.appDb.db.prepare('SELECT * FROM calendar_operations').all()).toHaveLength(1);
 }));
 it('recovers a failed confirmation delivery without repeating the booking',()=>scenario(async f=>{
  (f.a.gateway as any).shouldFail=true;await f.send('Book in clinic September 14 at 11am');
  expect(f.visits()).toHaveLength(1);const id=f.visits()[0].id;
  expect(f.a.db.appDb.db.prepare("SELECT * FROM outbound_jobs WHERE status='pending'").all().length).toBeGreaterThan(0);
  (f.a.gateway as any).shouldFail=false;await f.a.outbox.drain(true);
  expect(f.visits()).toHaveLength(1);expect(f.visits()[0].id).toBe(id);
  const c=f.a.db.customers.findByPhone(f.phone)!;expect((f.a.gateway as any).sentMessages.filter((m:any)=>m.to===c.phone)).toHaveLength(1);
 }));
});
