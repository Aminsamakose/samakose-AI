'use client';

import { useState } from 'react';
const API='/api/v1';
type Match={user?:{id:string;name?:string};score?:number;breakdown?:Record<string,unknown>;reason?:string;availability?:string;vettingStatus?:string;[key:string]:unknown};

export default function MatchingPage(){
 const [caseId,setCaseId]=useState('');
 const [fn,setFn]=useState('coach');
 const [specialisation,setSpecialisation]=useState('');
 const [matches,setMatches]=useState<Match[]>([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 async function load(){if(!caseId)return;setLoading(true);setError('');try{const q=new URLSearchParams({fn});if(specialisation)q.set('specialisation',specialisation);const r=await fetch(API+'/cases/'+caseId+'/matches?'+q,{credentials:'include'});if(!r.ok)throw new Error('Unable to load matching recommendations.');const body=await r.json();setMatches(Array.isArray(body)?body:body.data??[])}catch(e){setError(e instanceof Error?e.message:'Unable to load matches.');setMatches([])}finally{setLoading(false)}}
 return <main className="content" style={{maxWidth:1100,margin:'0 auto'}}>
  <div className="page-head"><div><div className="crumbs">Business Health / Expert & Coach Matching</div><h1>Expert & Coach Matching</h1><p className="muted">Review explainable practitioner recommendations using existing case matching, qualification, availability and conflict controls.</p></div></div>
  {error&&<div className="notice">{error}</div>}
  <section className="panel"><form className="connection-form" onSubmit={e=>{e.preventDefault();void load()}}><label>Case ID<input value={caseId} onChange={e=>setCaseId(e.target.value)} placeholder="Case UUID" required/></label><label>Function<select value={fn} onChange={e=>setFn(e.target.value)}><option value="lead">Lead Expert</option><option value="specialist">Specialist Expert</option><option value="coach">Coach</option></select></label><label>Specialisation<input value={specialisation} onChange={e=>setSpecialisation(e.target.value)} placeholder="Optional"/></label><button className="btn primary" disabled={loading}>{loading?'Matching…':'Find matches'}</button></form>
   <div className="match-list">{matches.map((m,i)=><article className="match-card" key={String(m.user?.id??i)}><div><h3>{m.user?.name??String(m.userId??'Practitioner')}</h3><span className="badge">{m.availability?String(m.availability):'Eligible'}</span> {m.vettingStatus&&<span className="badge muted-badge">{String(m.vettingStatus)}</span>}<p className="muted small">{m.reason?String(m.reason):'Recommended by the existing matching engine.'}</p></div><strong className="match-score">{m.score==null?'—':Number(m.score).toFixed(0)}<small> match</small></strong></article>)}{!matches.length&&<div className="empty">{caseId?(loading?'Finding eligible providers…':'No recommendations returned.'):'Enter a case ID to review recommendations.'}</div>}</div>
  </section>
 </main>;
}
