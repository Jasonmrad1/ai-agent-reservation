import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const ffmpeg=require('../.demo-tools/node_modules/ffmpeg-static');
const {EdgeTTS}=require('../.demo-tools/node_modules/@andresaya/edge-tts');
const dir=path.resolve('artifacts/demo-simulator');
const source=JSON.parse(fs.readFileSync(path.join(dir,'source.json'),'utf8'));
if(source.scenes.length!==8)throw new Error('Complete all eight simulator chapters before exporting.');
const narrationDir=path.join(dir,'narration');fs.mkdirSync(narrationDir,{recursive:true});

const run=(args,allowFailure=false)=>new Promise((resolve,reject)=>{
 const process=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let log='';
 process.stderr.on('data',d=>{log+=d;if(log.length>30000)log=log.slice(-20000);});
 process.on('error',reject);process.on('exit',code=>code===0||allowFailure?resolve(log):reject(new Error(log.slice(-2400))));
});
async function duration(file){
 const log=await run(['-i',file],true);const match=log.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
 if(!match)throw new Error(`Unreadable media: ${file}`);return Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
}
const stamp=seconds=>{
 const centiseconds=Math.round(seconds*100);return `${Math.floor(centiseconds/360000)}:${String(Math.floor(centiseconds/6000)%60).padStart(2,'0')}:${String(Math.floor(centiseconds/100)%60).padStart(2,'0')}.${String(centiseconds%100).padStart(2,'0')}`;
};
const escape=text=>text.replace(/\\/g,'/').replace(/[{}]/g,'').replace(/\n/g,'\\N');
const assHeader=`[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Brand,Segoe UI,24,&H00F5F5F5,&H00F5F5F5,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1
Style: Title,Segoe UI,30,&H00F5F5F5,&H00F5F5F5,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Small,Segoe UI,18,&H00B9B1A3,&H00B9B1A3,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Proof,Segoe UI,20,&H00B0FBE2,&H00B0FBE2,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Shape,Segoe UI,18,&H005BC5FF,&H005BC5FF,&H005BC5FF,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
const event=(start,end,style,text,layer=2)=>`Dialogue: ${layer},${stamp(start)},${stamp(end)},${style},,0,0,0,,${text}\n`;
const voices=[];const lengths=[];const chapters=[];let elapsed=0;
for(let i=0;i<source.scenes.length;i++){
 const scene=source.scenes[i];const voice=path.join(narrationDir,`chapter-${i}.mp3`);
 if(!fs.existsSync(voice)){
  console.log('Neural narration:',scene.title);const tts=new EdgeTTS();
  await tts.synthesize(scene.detail,'en-US-JennyNeural',{rate:'-3%',pitch:'+0Hz'});
  await tts.toFile(voice.replace(/\.mp3$/,''));
 }
 const voiceSeconds=await duration(voice);const length=Math.ceil(Math.max(scene.end-scene.start,voiceSeconds+1.5)*30)/30;
 voices.push({file:voice,seconds:voiceSeconds});lengths.push(length);chapters.push({seconds:elapsed,title:scene.title,detail:scene.detail});elapsed+=length;
}

const clips=[];
for(let i=0;i<source.scenes.length;i++){
 const scene=source.scenes[i],length=lengths[i];let ass=assHeader;
 ass+=event(0,length,'Brand','{\\pos(160,24)}DR. ZIAD  /  PATIENT SIMULATOR');
 ass+=event(0,length,'Small',`{\\an9\\pos(1760,30)}OFFLINE MVP  ·  REAL WEBSITE  ·  ${String(i+1).padStart(2,'0')} / 08`);
 ass+=event(0,length,'Title',`{\\move(105,996,160,996,0,500)\\fad(250,250)}${String(i+1).padStart(2,'0')}   ${escape(scene.title.toUpperCase())}`);
 ass+=event(0,length,'Small','{\\pos(160,1037)\\fad(500,250)}Message → assistant reply → saved calendar result');
 // A small moving timeline sits below the browser, away from product controls.
 ass+=event(0,length,'Shape',`{\\pos(160,1069)\\p1\\1c&H40352A&}m 0 0 l 1600 0 l 1600 3 l 0 3{\\p0}`,0);
 ass+=event(0,length,'Shape',`{\\pos(160,1069)\\p1\\fscx1\\1c&H86DE4A&\\t(0,${Math.round(length*1000)},\\fscx100)}m 0 0 l 1600 0 l 1600 3 l 0 3{\\p0}`,1);
 for(const proof of source.proofs.filter(p=>p.start>=scene.start&&p.start<scene.end)){
  const begin=proof.start-scene.start,end=Math.min(length,proof.end-scene.start+0.8);
  ass+=event(begin,end,'Proof',`{\\an9\\move(1790,1007,1760,1007,0,450)\\fad(250,300)}✓ ${escape(proof.label)}`);
 }
 // Real click positions recorded by Playwright; these rings are editing effects.
 for(const click of source.clicks.filter(c=>c.seconds>=scene.start&&c.seconds<scene.end)){
  const begin=click.seconds-scene.start,end=Math.min(length,begin+0.65);
  ass+=event(begin,end,'Shape',`{\\an5\\pos(${Math.round(click.x+160)},${Math.round(click.y+76)})\\bord2\\shad0\\1a&HFF&\\3c&H86DE4A&\\fscx60\\fscy60\\t(0,650,\\fscx160\\fscy160\\3a&HFF&)\\p1}m -11 0 b -11 -6 -6 -11 0 -11 b 6 -11 11 -6 11 0 b 11 6 6 11 0 11 b -6 11 -11 6 -11 0{\\p0}`,5);
 }
 const subtitle=path.join(dir,`scene-${i}.ass`);fs.writeFileSync(subtitle,ass);
 const clip=path.join(dir,`edited-${i}.mp4`);clips.push(clip);
 console.log('Animating chapter:',scene.title);
 const vf=`fps=30,tpad=stop_mode=clone:stop_duration=${Math.max(0,length-(scene.end-scene.start)).toFixed(3)},trim=duration=${length},pad=1920:1080:160:76:color=0x090F18,drawbox=x=158:y=74:w=1604:h=904:color=0x243545:t=2,subtitles=artifacts/demo-simulator/scene-${i}.ass,fade=t=in:st=0:d=0.18,fade=t=out:st=${(length-0.18).toFixed(3)}:d=0.18,format=yuv420p`;
 if(!process.argv.includes('--reuse-clips') || !fs.existsSync(clip))await run(['-y','-ss',String(scene.start),'-t',String(scene.end-scene.start),'-i',source.raw,'-an','-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','19',clip]);
}
const list=path.join(dir,'concat.txt');fs.writeFileSync(list,clips.map(file=>`file '${file.replace(/\\/g,'/')}'`).join('\n'));
const silent=path.join(dir,'Dr-Ziad-Simulator-Visual.mp4');
await run(['-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',silent]);
const seconds=await duration(silent);const sampleRate=48000;const voicePcm=Buffer.alloc(Math.ceil(seconds*sampleRate)*2);
for(let i=0;i<voices.length;i++){
 const pcm=path.join(narrationDir,`chapter-${i}.pcm`);await run(['-y','-i',voices[i].file,'-ar',String(sampleRate),'-ac','1','-f','s16le',pcm]);
 const data=fs.readFileSync(pcm);const offset=Math.round((chapters[i].seconds+0.65)*sampleRate)*2;
 data.copy(voicePcm,offset,0,Math.min(data.length,voicePcm.length-offset));
}
const narration=path.join(narrationDir,'voice.pcm');fs.writeFileSync(narration,voicePcm);

// Original instrumental composition: warm pads, a gentle arpeggio and soft pulse.
// No downloaded tracks or stock-music licensing dependency.
const frames=Math.ceil(seconds*sampleRate);const music=Buffer.alloc(frames*4);const beat=60/108;
const chords=[[220,261.626,329.628],[174.614,220,261.626],[130.813,164.814,195.998],[195.998,246.942,293.665]];
let random=17;
for(let frame=0;frame<frames;frame++){
 const t=frame/sampleRate;const bar=Math.floor(t/(beat*4));const chord=chords[Math.floor(bar/2)%chords.length];
 const phase=t%(beat*4);const swell=0.65+0.35*Math.sin(Math.PI*phase/(beat*4));
 const previous=chords[(Math.floor(bar/2)+3)%4];const blend=Math.min(1,(t%(beat*8))/0.28);
 let pad=0;for(let n=0;n<3;n++){
  const wave=f=>(Math.sin(2*Math.PI*f*t)+0.22*Math.sin(2*Math.PI*f*2*t))/3;
  pad+=wave(chord[n])*blend+wave(previous[n])*(1-blend);
 }
 const step=Math.floor(t/(beat/2));const arpFrequency=chord[step%3]*2;const age=t%(beat/2);
 const arp=Math.min(1,age/0.012)*Math.exp(-age*9)*(Math.sin(2*Math.PI*arpFrequency*age)+0.12*Math.sin(2*Math.PI*arpFrequency*3*age));
 const kickAge=t%(beat*2);const kick=0.3*Math.exp(-kickAge*24)*Math.sin(2*Math.PI*(44*kickAge+1.7*(1-Math.exp(-kickAge*30))));
 random=(Math.imul(random,1664525)+1013904223)>>>0;
 const hat=((random/4294967296)*2-1)*Math.exp(-age*95)*0.045;
 const fade=Math.min(1,t/2,(seconds-t)/3);
 const sample=(pad*swell*0.28+arp*0.17+kick+hat)*fade*0.25;
 const right=sample*0.96+Math.sin(2*Math.PI*chord[1]*t+0.04)*0.004*fade;
 music.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(sample*32767))),frame*4);
 music.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(right*32767))),frame*4+2);
}
const score=path.join(narrationDir,'original-score.pcm');fs.writeFileSync(score,music);
const final=path.join(dir,'Dr-Ziad-Simulator-Demo.mp4');
await run(['-y','-i',silent,'-f','s16le','-ar',String(sampleRate),'-ac','1','-i',narration,'-f','s16le','-ar',String(sampleRate),'-ac','2','-i',score,
 '-filter_complex','[1:a]loudnorm=I=-17:TP=-2:LRA=8,aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][duck];[2:a][duck]sidechaincompress=threshold=0.035:ratio=5:attack=25:release=500[music];[voice][music]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.84:level=false[a]',
 '-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',String(seconds),'-movflags','+faststart',final]);
fs.writeFileSync(path.join(dir,'walkthrough.json'),JSON.stringify({durationSeconds:seconds,voice:'en-US-JennyNeural',music:'Original synthesized instrumental',chapters,proofs:source.proofs,allActionsViaWebsite:true,providers:'offline mocks'},null,2));
const htmlEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chapterButtons=chapters.map((c,i)=>`<button data-time="${c.seconds}"><span>${String(i+1).padStart(2,'0')}</span>${htmlEscape(c.title)}<small>${Math.floor(c.seconds/60)}:${String(Math.floor(c.seconds)%60).padStart(2,'0')}</small></button>`).join('');
fs.writeFileSync(path.join(dir,'Watch-Demo.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dr. Ziad — Simulator Demo</title><style>
*{box-sizing:border-box}body{margin:0;background:#090f18;color:#eef4fa;font:16px system-ui;padding:32px}main{max-width:1400px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}h1{font-size:25px;margin:0}header p{color:#91a6b7;font-size:13px}video{width:100%;border:1px solid #294052;border-radius:16px;box-shadow:0 20px 80px #0008}nav{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}button{cursor:pointer;background:#121e2b;border:1px solid #294052;color:#eef4fa;border-radius:10px;padding:16px;text-align:left;font:inherit;transition:background .2s,transform .2s}button:hover,button.active{background:#173c36;border-color:#34d399;transform:translateY(-2px)}button span{color:#34d399;font-size:12px;display:block;margin-bottom:6px}button small{display:block;color:#91a6b7;margin-top:8px}footer{color:#91a6b7;font-size:13px;margin:24px 0} @media(max-width:800px){body{padding:16px}nav{grid-template-columns:repeat(2,1fr)}header{display:block}}
</style><main><header><h1>Dr. Ziad · Patient Simulator</h1><p>Actual website · Saved calendar results · Offline MVP</p></header><video controls preload="metadata" src="Dr-Ziad-Simulator-Demo.mp4"></video><nav aria-label="Demo chapters">${chapterButtons}</nav><footer>Choose a chapter to jump to that workflow. Fictional patients, simulated AI and messaging. Hours, bookings and saved appointment details come from the actual application.</footer></main><script>
const video=document.querySelector('video'),buttons=[...document.querySelectorAll('nav button')];for(const button of buttons)button.addEventListener('click',()=>{video.currentTime=Number(button.dataset.time);video.play().catch(()=>{});});video.addEventListener('timeupdate',()=>{let active=0;buttons.forEach((b,i)=>{if(video.currentTime>=Number(b.dataset.time))active=i});buttons.forEach((b,i)=>b.classList.toggle('active',i===active));});
</script></html>`);
console.log(JSON.stringify({final,durationSeconds:seconds,chapters:chapters.length}));
