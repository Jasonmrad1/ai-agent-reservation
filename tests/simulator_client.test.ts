import {it,expect,vi} from 'vitest';import {simulatorRequest} from '../src/simulator/client.js';
it('authenticates simulator requests and checks rejected HTTP responses',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({error:'Unauthorized'})});
 await expect(simulatorRequest('http://localhost:3000/api/simulator/history','secret',{},fetcher)).rejects.toThrow(/401/);
 expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
 await expect(simulatorRequest('http://localhost:3000/api/simulator/history','',{},fetcher)).rejects.toThrow(/secret/);expect(fetcher).toHaveBeenCalledTimes(1);
});
