import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const ffmpeg=require('../.demo-tools/node_modules/ffmpeg-static');
const dir=path.resolve('artifacts/demo');
const run=(command,args,allowFailure=false)=>new Promise((resolve,reject)=>{
 const child=spawn(command,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('exit',code=>code===0||allowFailure?resolve(stderr):reject(new Error(stderr.slice(-2000))));
});
await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/narrate-demo.ps1'),'-DemoOutput',dir]);
const duration=async file=>{const info=await run(ffmpeg,['-i',file],true);const match=info.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);if(!match)throw new Error('Cannot read media duration');return Number(match[1])*3600+Number(match[2])*60+Number(match[3]);};
const video=path.join(dir,'Dr-Ziad-MVP-Demo.mp4');const seconds=await duration(video);
const {chapters}=JSON.parse(fs.readFileSync(path.join(dir,'walkthrough.json'),'utf8'));
const sampleRate=48000;const bytesPerSecond=sampleRate*2;
const pcm=Buffer.alloc(Math.ceil(seconds*sampleRate)*2);
for(let i=0;i<chapters.length;i++){
 const file=path.join(dir,'narration',`chapter-${i}.wav`);
 const room=Math.max(1,(chapters[i+1]?.seconds ?? seconds)-chapters[i].seconds-0.5);
 let tempo=Math.max(1,(await duration(file))/room);const tempos=[];while(tempo>2){tempos.push('atempo=2');tempo/=2;}tempos.push(`atempo=${tempo.toFixed(4)}`);
 const raw=path.join(dir,'narration',`chapter-${i}.pcm`);
 await run(ffmpeg,['-y','-i',file,'-af',tempos.join(','),'-ar',String(sampleRate),'-ac','1','-f','s16le',raw]);
 const clip=fs.readFileSync(raw);const offset=chapters[i].seconds*bytesPerSecond;
 clip.copy(pcm,offset,0,Math.min(clip.length,Math.floor(room*sampleRate)*2,pcm.length-offset));
}
const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(bytesPerSecond,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
const narration=path.join(dir,'narration','combined.wav');fs.writeFileSync(narration,Buffer.concat([header,pcm]));
const args=['-y','-i',video,'-i',narration,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','128k','-t',String(seconds),'-movflags','+faststart',path.join(dir,'Dr-Ziad-MVP-Demo-Narrated.mp4')];
await run(ffmpeg,args);console.log(JSON.stringify({durationSeconds:seconds,chapters:chapters.length,output:path.join(dir,'Dr-Ziad-MVP-Demo-Narrated.mp4')}));
