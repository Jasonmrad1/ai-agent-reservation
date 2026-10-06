import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require('../.demo-tools/node_modules/playwright');
for(const key of ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','GEMINI_API_KEY','GOOGLE_CALENDAR_CLIENT_ID','GOOGLE_CALENDAR_CLIENT_SECRET','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])process.env[key]='';
process.env.APP_MODE='simulator';process.env.SIMULATOR_LIVE_AI='false';
const {createApp}=await import('../dist/app.js');
const out=path.resolve('artifacts/demo-cinematic');fs.mkdirSync(out,{recursive:true});
const secret=crypto.randomBytes(32).toString('hex');const a=createApp({config:{mode:'simulator',nodeEnv:'development',port:3000,databaseUrl:':memory:',adminSessionSecret:secret,adminWhatsappNumber:'whatsapp:+96171090999',homeVisitBufferMinutes:30}});
const server=a.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});const ctx=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:path.join(out,'raw'),size:{width:1600,height:900}}});
const page=await ctx.newPage();page.setDefaultTimeout(18000);page.on('dialog',d=>d.accept());
const start=Date.now();const scenes=[];const transcript=[];const time=()=> (Date.now()-start)/1000;const pause=ms=>new Promise(r=>setTimeout(r,ms));
const monday=new Date();monday.setUTCHours(12,0,0,0);monday.setUTCDate(monday.getUTCDate()+((8-monday.getUTCDay())%7 || 7));const tuesday=new Date(monday);tuesday.setUTCDate(tuesday.getUTCDate()+1);
const date=d=>d.toISOString().slice(0,10);const spoken=d=>d.toLocaleDateString('en-US',{month:'long',day:'numeric',timeZone:'UTC'});
async function click(locator){await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();if(box)await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:18});await pause(350);await locator.click();await pause(300);}
async function scene(title,detail,run){console.log('Scene:',title);const from=time();await run();await pause(2300);const end=time();scenes.push({title,detail,start:from,end});await page.screenshot({path:path.join(out,`${String(scenes.length).padStart(2,'0')}.png`)});}
async function send(text,pattern){const input=page.locator('.wa-chat-footer textarea');await click(input);await input.pressSequentially(text,{delay:28});const pending=page.waitForResponse(r=>r.url().endsWith('/api/simulator/message')&&r.request().method()==='POST');await click(page.getByRole('button',{name:'Send',exact:true}));const response=await pending;assert.equal(response.status(),200);const data=await response.json();if(pattern)assert.match(data.reply,pattern);transcript.push({message:text,reply:data.reply,appointments:data.appointments});await pause(Math.min(5500,1800+data.reply.length*6));return data;}
async function formBooking(name,phone,day,clock){await click(page.getByRole('button',{name:'New Appointment',exact:true}));await page.getByPlaceholder('+961 71 476 193 or 71476193').pressSequentially(phone,{delay:45});await page.getByPlaceholder('e.g. Farah Haddad').pressSequentially(name,{delay:75});await page.locator('.modal-card input[type=date]').fill(date(day));await pause(450);await page.locator('.modal-card input[type=time]').fill(clock);await pause(1000);await click(page.getByRole('button',{name:'Book Appointment',exact:true}));await pause(1500);}
let raw;
try{
 // Login is an actual UI action; it is excluded from the final edit to avoid showing credentials.
 await page.goto(base+'/admin/login');await page.locator('input[name=secret]').fill(secret);await click(page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL('**/admin/dashboard');
 await scene('Configure working hours','First, configure the clinic hours using the website. Monday and Tuesday open at nine thirty and close at five thirty.',async()=>{
  await click(page.getByRole('button',{name:'Work Hours',exact:true}));await click(page.getByRole('button',{name:'All-Time Default Template',exact:true}));await click(page.getByRole('button',{name:'Time Inputs Form',exact:true}));
  for(const day of ['Monday','Tuesday']){const row=page.locator('.day-schedule-row').filter({hasText:day});await row.locator('input[type=time]').nth(0).fill('09:30');await pause(650);await row.locator('input[type=time]').nth(1).fill('17:30');await pause(650);}
  await click(page.getByRole('button',{name:'45 mins',exact:true}));await click(page.getByRole('button',{name:'Save All-Time Default Hours',exact:true}).first());await pause(1800);
  assert.equal(a.db.availability.getAllRules().find(r=>r.day_of_week===1).start_time,'09:30');assert.equal(a.db.settings.get('home_visit_buffer_minutes'),'45');
  await pause(1800);
 });
 await page.goto(base+'/admin/simulator');await page.locator('.wa-sim-patient-bar input').nth(0).fill('+96171091001');await page.locator('.wa-sim-patient-bar input').nth(1).fill('Samir Demo');await pause(700);
 await scene('Send a booking request','Now use the built-in patient simulator. Its test records are separate from the clinic calendar, keeping the demo isolated.',async()=>{
  const data=await send(`Book in clinic ${spoken(monday)} at 11am`,/confirmed/i);assert.equal(data.appointments.length,1);
 });
 await scene('Cancel the visit','The patient cancels the appointment. The assistant replies and removes the active booking.',async()=>{const data=await send('cancel my appointment',/cancelled/i);assert.equal(data.appointments.length,0);});
 await scene('Book again','A fresh booking can use the slot that was released by cancellation.',async()=>{const data=await send(`Book in clinic ${spoken(monday)} at 11am`,/confirmed/i);assert.equal(data.appointments.length,1);});
 await scene('Reschedule through chat','The patient asks for a different day and time. The existing appointment is moved rather than duplicated.',async()=>{const data=await send(`Move my appointment to ${spoken(tuesday)} at 2pm`,/rescheduled/i);assert.equal(data.appointments.length,1);});
 await page.goto(base+'/admin/simulator');await page.locator('.wa-sim-patient-bar input').nth(0).fill('+96171091002');await page.locator('.wa-sim-patient-bar input').nth(1).fill('Maya Demo');await pause(700);
 await scene('Book a home visit','For a home visit, the assistant collects the address before confirming the booking.',async()=>{await send(`Book a home visit ${spoken(monday)} at 1pm`,/address/i);const data=await send('My address is Beirut, Hamra, building 20, floor 2',/confirmed/i);assert.equal(data.appointments[0].visit_type,'home_visit');});
 await page.goto(base+'/admin/dashboard');await click(page.getByRole('button',{name:'Next week',exact:true}));
 await scene('Schedule from the calendar','Back in the clinic calendar, add a walk-in appointment using the actual manual booking form.',async()=>{await formBooking('Rana Demo','+96171091003',monday,'10:00');assert.equal(a.db.appDb.db.prepare('SELECT * FROM appointments').all().length,1);});
 await scene('Move a calendar appointment','Open the visit and reschedule it directly. The calendar updates after saving.',async()=>{
  await click(page.locator('.teams-meeting-card').filter({hasText:'Rana'}));await click(page.getByRole('button',{name:'Move / Reschedule',exact:true}));await page.locator('.modal-card input[type=date]').fill(date(tuesday));await pause(700);await page.locator('.modal-card input[type=time]').fill('15:00');await pause(1000);await click(page.getByRole('button',{name:'Move Appointment',exact:true}));await pause(1600);
  assert.equal(a.db.appDb.db.prepare('SELECT status FROM appointments').get().status,'rescheduled');
 });
 await scene('Send a clinic message','Use Quick WhatsApp to send the patient a message from the visit details. This demo uses a mock delivery gateway.',async()=>{
  await click(page.locator('.teams-meeting-card').filter({hasText:'Rana'}));await click(page.getByRole('button',{name:'Quick WhatsApp',exact:true}));await page.getByPlaceholder('Type message to send directly to patient over WhatsApp...').pressSequentially('Hello Rana, your appointment is confirmed for 3 PM. See you at the clinic.',{delay:24});await pause(1200);await click(page.getByRole('button',{name:'Send via WhatsApp',exact:true}));await pause(1700);
 });
 await scene('Remove a calendar visit','Cancel the visit through its details. The card disappears from the calendar.',async()=>{await click(page.locator('.teams-meeting-card').filter({hasText:'Rana'}));await click(page.getByRole('button',{name:'Cancel Visit',exact:true}));await pause(1500);assert.equal(a.db.appDb.db.prepare('SELECT status FROM appointments').get().status,'cancelled');});
 await scene('Complete a visit','Finally, record a completed visit from the website. Completion saves the visit and generates its invoice.',async()=>{await formBooking('Karim Demo','+96171091004',monday,'14:00');await click(page.locator('.teams-meeting-card').filter({hasText:'Karim'}));await click(page.getByRole('button',{name:'Complete Visit',exact:true}));await pause(1500);assert.equal(a.db.invoices.listAll().length,1);});
 await scene('Clinic overview','This is the unchanged website running with demo data. Live AI, WhatsApp and phone integration remain separate pilot checks.',async()=>{await pause(2200);});
}finally{
 raw=await page.video().path();await ctx.close();await browser.close();await new Promise(r=>server.close(r));a.db.appDb.close();a.simulator.db.appDb.close();
 fs.writeFileSync(path.join(out,'source.json'),JSON.stringify({raw,scenes,transcript,unchangedWebsite:true,providers:'offline mocks'},null,2));
}
console.log('Raw recording complete:',raw);
