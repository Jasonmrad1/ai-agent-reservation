import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const ffmpeg=require('../.demo-tools/node_modules/ffmpeg-static');const dir=path.resolve('artifacts/demo-cinematic');
const {raw,scenes}=JSON.parse(fs.readFileSync(path.join(dir,'source.json'),'utf8'));
if(scenes.length!==12)throw new Error('Recording is incomplete. Finish all 12 website scenes before exporting.');
const run=args=>new Promise((resolve,reject)=>{const child=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',d=>error+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(error.slice(-2000))));});
const clips=[];const duration=[];const chapter=[];const overlap=0.35;let elapsed=0;
for(let i=0;i<scenes.length;i++){
 const s=scenes[i];const file=path.join(dir,`scene-${i}.mp4`);const length=s.end-s.start;
 console.log('Editing scene:',s.title);
 await run(['-y','-ss',String(s.start),'-i',raw,'-t',String(length),'-an','-vf','fps=25,format=yuv420p','-c:v','libx264','-preset','veryfast','-crf','20',file]);
 clips.push(file);duration.push(length);chapter.push({seconds:Math.round(elapsed),title:s.title,detail:s.detail});elapsed+=length-overlap;
}
const args=['-y'];for(const clip of clips)args.push('-i',clip);
const filters=clips.map((_,i)=>`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);let offset=duration[0]-overlap;
for(let i=1;i<clips.length;i++){const prev=i===1?'v0':`x${i-1}`;filters.push(`[${prev}][v${i}]xfade=transition=fade:duration=${overlap}:offset=${offset.toFixed(3)}[x${i}]`);offset+=duration[i]-overlap;}
filters.push(`[x${clips.length-1}]fade=t=in:st=0:d=0.5,fade=t=out:st=${(elapsed+overlap-0.7).toFixed(3)}:d=0.7[edited]`);
args.push('-filter_complex_threads','2','-filter_complex',filters.join(';'),'-map','[edited]','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',path.join(dir,'Dr-Ziad-Website-Demo.mp4'));
await run(args);fs.writeFileSync(path.join(dir,'walkthrough.json'),JSON.stringify({chapters:chapter,transcript:[]},null,2));console.log('Cinematic website edit complete.');
