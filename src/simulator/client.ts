export async function simulatorRequest(url:string,secret:string,options:RequestInit={},fetcher:typeof fetch=fetch):Promise<Response>{
 if(!secret)throw new Error('Administrator secret is required for the simulator');
 const headers={...options.headers,Authorization:`Bearer ${secret}`};
 const response=await fetcher(url,{...options,headers,signal:options.signal || AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`Simulator request failed (${response.status})`);return response;
}
