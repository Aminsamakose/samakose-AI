'use client';

import { useEffect, useState } from 'react';

type Indicator={id:string;name:string;metric:string;metricLabel:string;unit:string;target:number;value:number|null;pct:number|null;status:string;level:string;dueDate?:string|null;note?:string|null};
const API='/api/v1';

export default function ProgrammeOutcomesPage(){
 const [programmeId,setProgrammeId]=useState('');
 const [indicators,setIndicators]=useState<Indicator[]>([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{const q=new URLSearchParams(window.location.search).get('programmeId');if(q)setProgrammeId(q)},[]);
 async function load(){if(!programmeId)return;setLoading(true);setError('');try{const r=await fetch(API+'/programmes/'+programmeId+'/indicators',{credentials:'include'});if(!r.ok)throw new Error('Unable to load programme indicators. Check programme access.');setIndicators(await r.json())}catch(e){setError(e instanceof Error?e.message:'Unable to load outcomes.');setIndicators([])}finally{setLoading(false)}}
 useEffect(()=>{if(programmeId)void load()},[programmeId]);
 const avg=indicators.length?indicators.reduce((n,i)=>n+(i.pct??0),0)/indicators.length:0;
 return <main className="content" style={{maxWidth:1280,margin:'0 auto'}}>
  <div className="page-head"><div><div className="crumbs">Programme / Outcomes & MEL</div><h1>Programme Outcomes & MEL</h1><p className="muted">Track programme targets against live, privacy-aware Business Health evidence. Indicator values are calculated from authoritative programme records.</p></div><form className="page-actions" onSubmit={e=>{e.preventDefault();void load()}}><input aria-label="Programme ID" placeholder="Programme ID" value={programmeId} onChange={e=>setProgrammeId(e.target.value)}/><button className="btn primary" disabled={loading}>{loading?'Loading…':'Load outcomes'}</button></form></div>
  {error&&<div className="notice">{error}</div>}
  <section className="metrics"><article className="metric"><span>Indicators</span><strong>{indicators.length}</strong><small>configured targets</small></article><article className="metric"><span>Average progress</span><strong>{indicators.length?avg.toFixed(0)+'%':'—'}</strong><small>across loaded indicators</small></article><article className="metric"><span>On track</span><strong>{indicators.filter(i=>i.status==='On track').length}</strong><small>current indicator status</small></article><article className="metric"><span>At risk</span><strong>{indicators.filter(i=>/risk|late/i.test(i.status)).length}</strong><small>requires attention</small></article></section>
  <section className="panel"><div className="panel-head"><h2>Indicator register</h2><p className="muted small">Outcome reporting should use these governed targets rather than manually reconstructed numbers.</p></div>
   {!indicators.length&&<div className="empty">{programmeId?(loading?'Loading indicators…':'No indicators configured for this programme.'):'Enter a programme ID to begin.'}</div>}
   <div className="indicator-list">{indicators.map(i=><article className="indicator-row" key={i.id}><div className="indicator-main"><span className="badge">{i.level}</span><h3>{i.name}</h3><p className="muted small">{i.metricLabel} · Target {i.target}{i.unit} {i.dueDate?'· Due '+i.dueDate:''}</p>{i.note&&<p className="muted small">{i.note}</p>}</div><div className="indicator-progress"><strong>{i.value==null?'—':String(i.value)+i.unit}</strong><div className="bar"><span style={{width:Math.max(0,Math.min(100,i.pct??0))+'%'}}/></div><small>{i.pct==null?'No visible value':Number(i.pct).toFixed(0)+'% progress · '+i.status}</small></div></article>)}</div>
  </section>
 </main>;
}
