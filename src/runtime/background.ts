/** Owns recurring work so shutdown can await all in-flight jobs. */
export class BackgroundTasks {
 private active=new Map<string,Promise<void>>();private timers:ReturnType<typeof setInterval>[]=[];private stopped=false;
 constructor(private onError:(name:string)=>void){}
 run(name:string,task:()=>Promise<void>):void {
  if(this.stopped || this.active.has(name))return;
  const promise=(async()=>{try{await task();}catch{try{this.onError(name);}catch{/* Reporting must not reject the worker. */}}})();
  this.active.set(name,promise);void promise.finally(()=>this.active.delete(name));
 }
 every(name:string,milliseconds:number,task:()=>Promise<void>,immediate=true):void {
  if(this.stopped)return;this.timers.push(setInterval(()=>this.run(name,task),milliseconds));if(immediate)this.run(name,task);
 }
 async stop():Promise<void>{this.stopped=true;for(const timer of this.timers)clearInterval(timer);await Promise.allSettled([...this.active.values()]);}
}
