import {it,expect,vi} from 'vitest';import request from 'supertest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it('does not write patient identities or message contents to process logs',async()=>{
 const logs:string[]=[];const spies=['log','warn','error'].map(m=>vi.spyOn(console,m as any).mockImplementation((...args:any[])=>{logs.push(args.map(String).join(' '));}));
 try{const a=createApp({config:{...config,databaseUrl:':memory:'}});await request(a.app).post('/api/webhook/whatsapp').send({From:'+96171000777',ProfileName:'Private Patient Sentinel',Body:'private symptom sentinel hello',MessageSid:'SM_PRIVATE'});
 expect(logs.join('\n')).not.toContain('+96171000777');expect(logs.join('\n')).not.toContain('private symptom sentinel');expect(logs.join('\n')).not.toContain('Private Patient Sentinel');
 }finally{spies.forEach(s=>s.mockRestore());}
});
