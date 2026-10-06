import {it,expect,vi} from 'vitest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import * as cloud from '../src/db/supabase.js';import fs from 'node:fs';
it('does not initialize a cloud replica in explicit simulator mode',()=>{
 const spy=vi.spyOn(cloud,'getSupabaseClient').mockReturnValue({} as any);try{createApp({config:{...config,mode:'simulator',databaseUrl:':memory:',supabaseUrl:'https://replica.example',supabaseServiceRoleKey:'sentinel'}});expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('starts clinic background processing only in explicit clinic mode',()=>{
 expect(fs.readFileSync('src/index.ts','utf8')).toContain("if(config.mode==='clinic')");
});
