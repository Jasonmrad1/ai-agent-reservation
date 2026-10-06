import React,{useState,useEffect} from 'react';
import {checkedFetch} from '../api';
export interface ClinicAlert {id:string;title:string;details:string;status:string;created_at:string}
export function ClinicAttention({alerts,onRefresh}:{alerts:ClinicAlert[];onRefresh:()=>void}) {
  const [conversations,setConversations]=useState<any[]>([]);
  const [error,setError]=useState('');
  const refresh=async()=>{try {const response=await checkedFetch('/admin/api/conversations');setConversations((await response.json()).conversations || []);}catch(e:any){setError(e.message);}};
  useEffect(()=>{void refresh();const timer=setInterval(()=>{void refresh();},15000);return()=>clearInterval(timer);},[]);
  const control=async(id:string,action:string)=>{try{await checkedFetch(`/admin/api/conversations/${id}/control`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});await refresh();}catch(e:any){setError(e.message);}};
  const resolve=async(id:string)=>{try{await checkedFetch(`/admin/api/alerts/${id}/resolve`,{method:'POST'});onRefresh();}catch(e:any){setError(e.message);}};
  const pending=alerts.filter(a=>a.status==='pending');
  return <details className="clinic-attention"><summary>Clinic attention ({pending.length}) · Human conversations ({conversations.filter(c=>c.status!=='active').length})</summary>
    {error && <p role="alert">{error}</p>}
    {pending.length===0 && <p>No pending alerts.</p>}
    {pending.map(a=><article key={a.id}><strong>{a.title}</strong><p>{a.details}</p><button onClick={()=>{void resolve(a.id);}}>Mark reviewed</button></article>)}
    <h3>Conversation control</h3>
    {conversations.map(c=><article key={c.id}><span>{c.name || c.phone} · {c.status==='active' ? 'Assistant active' : 'Human takeover'}</span><button onClick={()=>{void control(c.id,c.status==='active' ? 'takeover' : 'resume');}}>{c.status==='active' ? 'Take over' : 'Resume assistant'}</button></article>)}
  </details>;
}
