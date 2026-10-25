'use client';

import { useEffect, useMemo, useState } from 'react';

type Workspace = { id:string; programmeId:string; name:string; status:string; providerSource:string; participantConsentRequired:boolean; funderReportingEnabled:boolean };
type Summary = { participants:{total:number;active:number}; delivery:{sessionCompletionRate:number|null;attendanceRate:number|null}; coordination:{openTasks:number;openExceptions:number;criticalExceptions:number}; providers:{activeAssignments:number} };
type Participant={id:string; status:string; cohortId?:string|null};

const API='/api/v1';
const pct=(v:number|null|undefined)=>v==null?'—':`${Number(v).toFixed(0)}%`;

export default function ProgrammeCommandCentrePage(){
 const [id,setId]=useState('');
 const [workspace,setWorkspace]=useState<Workspace|null>(null);
 const [summary,setSummary]=useState<Summary|null>(null);
 const [participants,setParticipants]=useState<Participant[]>([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');

 useEffect(()=>{const q=new URLSearchParams(window.location.search).get('workspaceId');if(q)setId(q)},[]);

 async function load(){
  if(!id)return;
  setLoading(true);setError('');
  try{
   const [w,s,p]=await Promise.all([
    fetch(`${API}/programme-workspaces/${id}`,{credentials:'include'}),
    fetch(`${API}/programme-workspaces/${id}/monitoring/summary`,{credentials:'include'}),
    fetch(`${API}/programme-workspaces/${id}/participants`,{credentials:'include'})
   ]);
   if(!w.ok||!s.ok||!p.ok)throw new Error('Unable to load this Programme Workspace. Check the workspace ID and your access.');
   const workspaces=await w.json();
   const selected=(Array.isArray(workspaces)?workspaces:workspaces.items??[]).find((item:any)=>item.id===id);
   if(!selected)throw new Error('Programme Workspace not found in your accessible workspaces.');
   setWorkspace(selected);setSummary(await s.json());setParticipants(await p.json());
  }catch(e){setError(e instanceof Error?e.message:'Unable to load the workspace.');setWorkspace(null);setSummary(null);setParticipants([])}
  finally{setLoading(false)}
 }
 useEffect(()=>{if(id)void load()},[id]);

 const lifecycle=useMemo(()=>participants.reduce<Record<string,number>>((m,p)=>{m[p.status]=(m[p.status]??0)+1;return m},{}),[participants]);

 return <main className="content" style={{maxWidth:1320,margin:'0 auto'}}>
  <div className="page-head">
   <div><div className="crumbs">Programme Workspace / Command Centre</div><h1>Programme Command Centre</h1><p className="muted">One operational view of the programme workspace: configuration, participants, delivery health, coordination and provider capacity.</p></div>
   <form className="page-actions" onSubmit={e=>{e.preventDefault();void load()}}><input aria-label="Programme workspace ID" placeholder="Workspace ID" value={id} onChange={e=>setId(e.target.value)}/><button className="btn primary" disabled={loading}>{loading?'Loading…':'Open workspace'}</button></form>
  </div>
  {error&&<div className="notice">{error}</div>}
  {workspace&&<section className="panel"><div className="panel-head"><div><h2>{workspace.name}</h2><p className="muted small">Workspace {workspace.id} · Programme {workspace.programmeId}</p></div><span className="badge">{workspace.status}</span></div><div className="command-meta"><span>Provider source <strong>{workspace.providerSource}</strong></span><span>Participant consent <strong>{workspace.participantConsentRequired?'Required':'Not required'}</strong></span><span>Funder reporting <strong>{workspace.funderReportingEnabled?'Enabled':'Disabled'}</strong></span></div></section>}
  <section className="metrics">
   {[
    ['Participants',summary?String(summary.participants.total):'—',summary?`${summary.participants.active} active`:''],
    ['Delivery completion',pct(summary?.delivery.sessionCompletionRate),'sessions completed'],
    ['Attendance',pct(summary?.delivery.attendanceRate),'present + late'],
    ['Active providers',summary?String(summary.providers.activeAssignments):'—','programme assignments'],
    ['Open tasks',summary?String(summary.coordination.openTasks):'—','coordination'],
    ['Exceptions',summary?String(summary.coordination.openExceptions):'—',summary?`${summary.coordination.criticalExceptions} critical`:'']
   ].map(([l,v,n])=><article className="metric" key={l}><span>{l}</span><strong>{v}</strong><small>{n}</small></article>)}
  </section>
  <div className="two-col">
   <section className="panel"><div className="panel-head"><h2>Participant lifecycle</h2></div><div className="status-list">{Object.entries(lifecycle).sort((a,b)=>b[1]-a[1]).map(([s,n])=><div key={s}><span>{s}</span><strong>{n}</strong></div>)}{!participants.length&&<p className="empty">No participants loaded.</p>}</div></section>
   <section className="panel"><div className="panel-head"><h2>Command centre priorities</h2></div><div className="priority-list">
    <div><span className="dot warn"></span><div><strong>Delivery health</strong><p className="muted small">Use completion and attendance to identify cohorts requiring intervention.</p></div></div>
    <div><span className="dot bad"></span><div><strong>Exceptions</strong><p className="muted small">Critical exceptions should be owned, resolved and audited.</p></div></div>
    <div><span className="dot info"></span><div><strong>Provider performance</strong><p className="muted small">Review the four performance dimensions without collapsing them into one score.</p></div></div>
   </div></section>
  </div>
 </main>;
}
