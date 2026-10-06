import {it,expect,vi,afterEach} from 'vitest';import {checkedFetch} from '../client/src/api.js';
afterEach(()=>vi.unstubAllGlobals());
it('uses sandbox calendar endpoints on the simulator page and clinic endpoints on the dashboard',async()=>{
 const transport=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',transport);
 vi.stubGlobal('window',{location:{pathname:'/admin/simulator'}});
 await checkedFetch('/admin/api/appointments');expect(transport.mock.calls[0][0]).toBe('/api/simulator/admin/api/appointments');
 vi.stubGlobal('window',{location:{pathname:'/admin/dashboard'}});
 await checkedFetch('/admin/api/appointments');expect(transport.mock.calls[1][0]).toBe('/admin/api/appointments');
});
it('rejects failed HTTP mutations so the dashboard cannot show success',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Calendar unavailable'}),{status:400})));await expect(checkedFetch('/admin/api/appointments/1/cancel',{method:'POST'})).rejects.toThrow('Calendar unavailable');});
it('uses session CSRF credentials and redirects expired login',async()=>{const location={href:''};vi.stubGlobal('window',{__CSRF_TOKEN__:'csrf-token',location});const transport=vi.fn().mockResolvedValue(new Response('{}',{status:401}));vi.stubGlobal('fetch',transport);await expect(checkedFetch('/admin/api/settings',{method:'POST'})).rejects.toThrow(/sign in/i);expect(location.href).toBe('/admin/login');expect(new Headers(transport.mock.calls[0][1].headers).get('x-csrf-token')).toBe('csrf-token');});
