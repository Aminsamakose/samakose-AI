'use client';

import { FormEvent, useEffect, useState } from 'react';
const API='/api/v1';
type Conn={id:string;provider:string;accountLabel?:string|null;externalCalendarId?:string|null;status?:string};
type Event={id:string;title:string;startsAt:string;endsAt:string;provider:string;location?:string|null;meetingUrl?:string|null;status?:string};

export default function ProgrammeCalendarPage(){
 const [cohortId,setCohortId]=useState('');
 const [connections,setConnections]=useState<Conn[]>([]);
 const [events,setEvents]=useState<Event[]>([]);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 async function load(){setError('');try{const c=await fetch(API+'/calendar/connections',{credentials:'include'});if(!c.ok)throw new Error('Unable to load calendar connections.');setConnections(await c.json());if(cohortId){const e=await fetch(API+'/cohorts/'+cohortId+'/calendar-events',{credentials:'include'});if(!e.ok)throw new Error('Unable to load cohort calendar events.');setEvents(await e.json())}}catch(e){setError(e instanceof Error?e.message:'Unable to load calendar data.')}}
 useEffect(()=>{void load()},[cohortId]);
 async function connect(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch(API+'/calendar/connections',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:f.get('provider'),accountLabel:f.get('accountLabel')||null})});setMessage(r.ok?'Calendar connection saved.':'Calendar connection could not be saved.');await load()}
 async function disconnect(id:string){const r=await fetch(API+'/calendar/connections/'+id+'/disconnect',{method:'POST',credentials:'include'});setMessage(r.ok?'Calendar disconnected.':'Calendar could not be disconnected.');await load()}
 return <main className="content" style={{maxWidth:1200,margin:'0 auto'}}>
  <div className="page-head"><div><div className="crumbs">Programme / Calendar</div><h1>Calendar & Scheduling</h1><p className="muted">Provider-neutral scheduling for programme delivery. Delivery sessions remain authoritative; calendar events are synchronized representations.</p></div></div>
  {error&&<div className="notice">{error}</div>}{message&&<div className="notice">{message}</div>}
  <div className="two-col"><section className="panel"><div className="panel-head"><h2>Calendar connections</h2></div><form className="connection-form" onSubmit={connect}><label>Provider<select name="provider" defaultValue="INTERNAL"><option>INTERNAL</option><option>GOOGLE</option><option>MICROSOFT</option><option>ICS</option></select></label><label>Account label<input name="accountLabel" placeholder="e.g. Programme team calendar"/></label><button className="btn primary">Save connection</button></form><div className="status-list">{connections.map(c=><div key={c.id}><span><strong>{c.provider}</strong>{c.accountLabel?' · '+c.accountLabel:''}</span><button className="btn" type="button" onClick={()=>void disconnect(c.id)}>Disconnect</button></div>)}{!connections.length&&<p className="empty">No calendar connections configured.</p>}</div></section>
  <section className="panel"><div className="panel-head"><h2>Cohort calendar</h2><p className="muted small">Enter a cohort ID to view its scheduled events.</p></div><form className="connection-form" onSubmit={e=>{e.preventDefault();void load()}}><label>Cohort ID<input value={cohortId} onChange={e=>setCohortId(e.target.value)} placeholder="Cohort UUID"/></label><button className="btn primary">Load events</button></form><div className="status-list">{events.map(e=><div key={e.id}><span><strong>{e.title}</strong><small className="muted"> · {new Date(e.startsAt).toLocaleString()}</small></span><span>{e.provider}</span></div>)}{cohortId&&!events.length&&<p className="empty">No calendar events found.</p>}</div></section></div>
 </main>;
}
