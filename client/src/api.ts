/** Reject HTTP failures before an action can display a success message. */
export async function checkedFetch(input:RequestInfo|URL,init:RequestInit={}):Promise<Response> {
  if(typeof input==='string' && input.startsWith('/admin/api/') && typeof window!=='undefined' && window.location.pathname==='/admin/simulator'){
    input='/api/simulator/admin'+input.slice('/admin'.length);
  }
  const headers=new Headers(init.headers);
  if(typeof window!=='undefined' && window.__CSRF_TOKEN__) headers.set('x-csrf-token',window.__CSRF_TOKEN__);
  const response=await fetch(input,{...init,headers,credentials:'same-origin'});
  if(response.status===401) {
    if(typeof window!=='undefined') window.location.href='/admin/login';
    throw new Error('Session expired. Please sign in again.');
  }
  if(!response.ok) {
    let message=`Request failed (${response.status})`;
    try {const data=await response.clone().json();if(data.error) message=String(data.error);}catch{/* Non-JSON error. */}
    throw new Error(message);
  }
  return response;
}

export function clinicToday():Date {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Beirut',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const n=(name:string)=>Number(parts.find(p=>p.type===name)?.value);
  return new Date(n('year'),n('month')-1,n('day'));
}
