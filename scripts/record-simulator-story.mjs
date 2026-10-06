import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {chromium}=require('../.demo-tools/node_modules/playwright');
for(const key of ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','GEMINI_API_KEY','GOOGLE_CALENDAR_CLIENT_ID','GOOGLE_CALENDAR_CLIENT_SECRET','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])process.env[key]='';
process.env.APP_MODE='simulator';process.env.SIMULATOR_LIVE_AI='false';
const {createApp}=await import('../dist/app.js');
const out=path.resolve('artifacts/demo-simulator');fs.mkdirSync(out,{recursive:true});
const secret=crypto.randomBytes(32).toString('hex');
const a=createApp({config:{mode:'simulator',nodeEnv:'development',port:3000,databaseUrl:':memory:',adminSessionSecret:secret,adminWhatsappNumber:'whatsapp:+96171090999',homeVisitBufferMinutes:30}});
const server=a.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const ctx=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:path.join(out,'raw'),size:{width:1600,height:900}}});
const page=await ctx.newPage();page.setDefaultTimeout(18000);page.on('dialog',d=>d.accept());
const epoch=Date.now();const seconds=()=> (Date.now()-epoch)/1000;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const scenes=[],clicks=[],proofs=[],transcript=[];
const monday=new Date();monday.setUTCHours(12,0,0,0);monday.setUTCDate(monday.getUTCDate()+((8-monday.getUTCDay())%7||7));
const tuesday=new Date(monday);tuesday.setUTCDate(tuesday.getUTCDate()+1);
const date=d=>d.toISOString().slice(0,10);
const spoken=d=>d.toLocaleDateString('en-US',{month:'long',day:'numeric',timeZone:'UTC'});

async function click(target){
 await target.scrollIntoViewIfNeeded();const box=await target.boundingBox();
 if(box){await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:12});await pause(250);clicks.push({seconds:seconds(),x:box.x+box.width/2,y:box.y+box.height/2});}
 await target.click();await pause(250);
}
async function scene(title,detail,run){
 console.log('Recording:',title);const start=seconds();await run();await pause(1800);
 scenes.push({title,detail,start,end:seconds()});await page.screenshot({path:path.join(out,`${String(scenes.length).padStart(2,'0')}.png`)});
}
async function send(text,pattern){
 const input=page.locator('.wa-chat-footer textarea');await click(input);await input.pressSequentially(text,{delay:22});
 const pending=page.waitForResponse(r=>r.url().endsWith('/api/simulator/message')&&r.request().method()==='POST');
 await click(page.getByRole('button',{name:'Send',exact:true}));const response=await pending;assert.equal(response.status(),200);
 const data=await response.json();if(pattern)assert.match(data.reply,pattern);transcript.push({message:text,...data});await pause(2600);return data;
}
async function patient(name,phone){
 await click(page.getByRole('button',{name:'Patient Simulator',exact:true}));
 await page.locator('.wa-sim-patient-bar input').nth(0).fill(phone);await page.locator('.wa-sim-patient-bar input').nth(1).fill(name);await pause(700);
}
async function calendarProof(name,count,label,day,clock){
 await click(page.getByRole('button',{name:'Calendar',exact:true}));
 await pause(700);assert.equal(await page.locator('.teams-meeting-card').count(),count);
 const start=seconds();
 if(name){
  const card=page.locator('.teams-meeting-card').filter({hasText:name});assert.equal(await card.count(),1);await pause(1000);await click(card);
  assert.ok((await page.locator('.modal-card').innerText()).includes(name));
  const rows=a.simulator.db.appDb.db.prepare('SELECT appointments.*,customers.name FROM appointments JOIN customers ON customers.id=appointments.customer_id WHERE customers.name=? AND appointments.status IN (?, ?, ?)').all(name,'booked','confirmed','rescheduled');
  assert.equal(rows.length,1);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Beirut',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(rows[0].start_time));
  const part=k=>parts.find(p=>p.type===k).value;
  if(day)assert.equal(`${part('year')}-${part('month')}-${part('day')}`,date(day));if(clock)assert.equal(`${part('hour')}:${part('minute')}`,clock);
  await pause(4300);await page.screenshot({path:path.join(out,`proof-${proofs.length+1}.png`)});
  proofs.push({start,end:seconds(),label});await click(page.locator('.modal-card .modal-close-btn'));
 }else{
  await pause(4200);await page.screenshot({path:path.join(out,`proof-${proofs.length+1}.png`)});proofs.push({start,end:seconds(),label});
 }
 assert.equal(a.db.appDb.db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n,0);
}

let raw;
try{
 await page.goto(base+'/admin/login');await page.locator('input[name=secret]').fill(secret);await click(page.getByRole('button',{name:'Sign in',exact:true}));await page.waitForURL('**/admin/dashboard');
 await page.goto(base+'/admin/simulator');await pause(600);
 await scene('Set the schedule','Start with the real work hours page. Set Monday and Tuesday to nine thirty until five thirty, then save. These hours now govern the simulator calendar.',async()=>{
  await click(page.getByRole('button',{name:'Work Hours',exact:true}));await click(page.getByRole('button',{name:'All-Time Default Template',exact:true}));await click(page.getByRole('button',{name:'Time Inputs Form',exact:true}));
  for(const name of ['Monday','Tuesday']){const row=page.locator('.day-schedule-row').filter({hasText:name});await row.locator('input[type=time]').nth(0).fill('09:30');await pause(550);await row.locator('input[type=time]').nth(1).fill('17:30');await pause(550);}
  await click(page.getByRole('button',{name:'45 mins',exact:true}));await click(page.getByRole('button',{name:'Save All-Time Default Hours',exact:true}).first());await pause(900);
  await click(page.getByRole('button',{name:'Next week',exact:true}));
  assert.equal(a.simulator.db.availability.getAllRules().find(r=>r.day_of_week===1).start_time,'09:30');assert.equal(a.simulator.db.settings.get('home_visit_buffer_minutes'),'45');
  await calendarProof(null,0,'Hours saved · Monday and Tuesday 09:30–17:30');
 });
 await scene('Book by conversation','Samir asks for a clinic visit on Monday at eleven. The assistant confirms. Now open the calendar: the saved visit is there, with the same patient and time.',async()=>{
  await patient('Samir Demo','+96171091001');const data=await send(`Book in clinic ${spoken(monday)} at 11am`,/confirmed/i);assert.equal(data.appointments.length,1);
  await calendarProof('Samir Demo',1,'Saved booking · Monday 11:00 AM',monday,'11:00');
 });
 await scene('Move the existing visit','Samir changes plans and asks for Tuesday at two. Watch the same appointment move. The calendar shows the new date and time, with no duplicate booking.',async()=>{
  await click(page.getByRole('button',{name:'Patient Simulator',exact:true}));const original=transcript.at(-1).appointments[0].id;
  const data=await send(`Move my appointment to ${spoken(tuesday)} at 2pm`,/rescheduled/i);assert.equal(data.appointments.length,1);assert.equal(data.appointments[0].id,original);
  await calendarProof('Samir Demo',1,'Same booking moved · Tuesday 2:00 PM',tuesday,'14:00');
 });
 await scene('Cancel and verify','Next, Samir cancels in the chat. The assistant confirms cancellation. Back in the calendar, his card has disappeared and the slot is free again.',async()=>{
  await click(page.getByRole('button',{name:'Patient Simulator',exact:true}));const data=await send('cancel my appointment',/cancelled/i);assert.equal(data.appointments.length,0);
  await calendarProof(null,0,'Cancellation saved · No active appointment');
 });
 await scene('Book a fresh visit','Samir books a new visit on Monday at ten. Open the calendar again. A fresh booking is saved, while the cancelled visit stays cancelled.',async()=>{
  await click(page.getByRole('button',{name:'Patient Simulator',exact:true}));const data=await send(`Book in clinic ${spoken(monday)} at 10am`,/confirmed/i);assert.equal(data.appointments.length,1);
  await calendarProof('Samir Demo',1,'Fresh booking saved · Monday 10:00 AM',monday,'10:00');
 });
 await scene('Collect a home address','Maya requests a home visit at one. The assistant asks for her address before booking. After she shares it, the calendar shows a home visit with that address saved.',async()=>{
  await patient('Maya Demo','+96171091002');const pending=await send(`Book a home visit ${spoken(monday)} at 1pm`,/address/i);assert.equal(pending.appointments.length,0);
  const data=await send('My address is Beirut, Hamra, building 20, floor 2',/confirmed/i);assert.equal(data.appointments[0].visit_type,'home_visit');
  await calendarProof('Maya Demo',2,'Home visit saved · Address included',monday,'13:00');
  assert.equal(data.appointments[0].address,'Beirut, Hamra, building 20, floor 2');
 });
 await scene('Protect occupied slots','What if another patient asks for Samir’s time? Rana requests Monday at ten. The assistant rejects the occupied slot. The calendar still has only the two existing visits.',async()=>{
  await patient('Rana Demo','+96171091003');const data=await send(`Book in clinic ${spoken(monday)} at 10am`);assert.equal(data.appointments.length,0);assert.doesNotMatch(data.reply,/has been confirmed/i);
  await calendarProof(null,2,'Conflict prevented · Existing visits preserved');
 });
 await scene('Choose an alternative','Rana chooses Tuesday at three instead. Her booking is confirmed and appears in the calendar. Three saved visits, all created through the simulator. Test freely, with no Twilio messages.',async()=>{
  await click(page.getByRole('button',{name:'Patient Simulator',exact:true}));const data=await send(`Book in clinic ${spoken(tuesday)} at 3pm`,/confirmed/i);assert.equal(data.appointments.length,1);
  await calendarProof('Rana Demo',3,'Alternative saved · Tuesday 3:00 PM',tuesday,'15:00');await pause(2000);
 });
}finally{
 raw=await page.video().path();await ctx.close();await browser.close();await new Promise(r=>server.close(r));a.db.appDb.close();a.simulator.db.appDb.close();
 fs.writeFileSync(path.join(out,'source.json'),JSON.stringify({raw,scenes,clicks,proofs,transcript,actualWebsite:true,providers:'offline mocks'},null,2));
}
console.log('Simulator story recorded:',raw);
