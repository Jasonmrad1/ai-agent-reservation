import {it,expect} from 'vitest';import {BackgroundTasks} from '../src/runtime/background.js';
it('waits for running work and prevents overlap or new work during shutdown',async()=>{
 const worker=new BackgroundTasks(()=>{});let release!:()=>void;const gate=new Promise<void>(r=>release=r);let calls=0;
 const task=async()=>{calls++;await gate;};worker.run('job',task);worker.run('job',task);expect(calls).toBe(1);
 let stopped=false;const stopping=worker.stop().then(()=>stopped=true);await Promise.resolve();expect(stopped).toBe(false);worker.run('other',task);expect(calls).toBe(1);release();await stopping;expect(stopped).toBe(true);
});
it('captures worker failures without an unhandled rejection',async()=>{
 const errors:string[]=[];const worker=new BackgroundTasks(name=>errors.push(name));worker.run('failing',async()=>{throw new Error('private provider payload');});await worker.stop();expect(errors).toEqual(['failing']);
});
