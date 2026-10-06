import {it,expect} from 'vitest';import fs from 'node:fs';
const lock=()=>JSON.parse(fs.readFileSync('package-lock.json','utf8')).packages;
const atLeast=(actual:string,min:string)=>{const a=actual.split('.').map(Number),b=min.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return true;};
function safe(name:string,min:string,optional=false){const versions=Object.entries(lock()).filter(([path])=>path.endsWith('node_modules/'+name)).map(([,p]:any)=>p.version);if(!optional)expect(versions.length).toBeGreaterThan(0);expect(versions.every(v=>atLeast(v,min))).toBe(true);}
it('locks proxy-addr with the IP spoofing fix',()=>safe('proxy-addr','2.0.8'));
it('locks qs with the denial-of-service fixes',()=>safe('qs','6.16.0'));
it('locks source-map-js with the event-loop denial-of-service fix',()=>safe('source-map-js','1.2.2'));
it('removes UUID or locks checked buffer bounds in Google dependencies',()=>safe('uuid','11.1.1',true));
it('locks the test runner without vulnerable worker and mocker dependencies',()=>{
 safe('vitest','5.0.3');safe('tinypool','2.1.2',true);safe('@vitest/mocker','4.1.11',true);
});
