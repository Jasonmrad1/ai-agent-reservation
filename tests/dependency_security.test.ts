import {it,expect} from 'vitest';import fs from 'node:fs';
const lock=()=>JSON.parse(fs.readFileSync('package-lock.json','utf8')).packages;
const atLeast=(actual:string,min:string)=>{const a=actual.split('.').map(Number),b=min.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return true;};
function safe(name:string,min:string){const versions=Object.entries(lock()).filter(([path])=>path.endsWith('node_modules/'+name)).map(([,p]:any)=>p.version);expect(versions.length).toBeGreaterThan(0);expect(versions.every(v=>atLeast(v,min))).toBe(true);}
it('locks proxy-addr with the IP spoofing fix',()=>safe('proxy-addr','2.0.8'));
it('locks qs with the denial-of-service fixes',()=>safe('qs','6.16.0'));
