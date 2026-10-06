'use client';

import { useState } from 'react';

type Report={programme:{id:string;code:string;name:string;funder?:string|null;status:string;startDate?:string|null;endDate?:string|null};total:number|null;byState:{key:string;n:number|null}[];maturity:{key:string;n:number|null}[];scoreChange:{n:number|null;average:number|null};dimensions:{dimension:string;avg_value?:number;avgValue?:number|null;n?:number}[];cohorts:{id:string;name:string;capacity:number;enrolled:number|null}[];indicators:any[];suppressed:boolean;minGroupSize:number};
const API='/api/v1';

export default function ProgrammeReportingPage(){
 const [id,setId]=useState('');
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 async function load(){if(!id)return;setLoading(true);setError('');try{const r=await fetch(API+'/programmes/'+id+'/dashboard',{credentials:'include'});if(!r.ok)throw new Error('Unable to load the programme report.');const body=await r.json();setReport(body.data??body)}catch(e){setError(e instanceof Error?e.message:'Unable to load report.');setReport(null)}finally{setLoading(false)}}
 function exportCsv(){window.location.assign(API+'/programmes/'+id+'/export')}
 return <main className="content" style={{maxWidth:1280,margin:'0 auto'}}>
  <div className="page-head"><div><div className="crumbs">Programme / Reporting</div><h1>Programme Reporting</h1><p className="muted">A report view generated from authoritative programme records, indicators and Business Health results.</p></div><form className="page-actions" onSubmit={e=>{e.preventDefault();void load()}}><input aria-label="Programme ID" placeholder="Programme ID" value={id} onChange={e=>setId(e.target.value)}/><button className="btn primary" disabled={loading}>{loading?'Generating…':'Generate report'}</button>{report&&<button className="btn" type="button" onClick={exportCsv}>Export CSV</button>}</form></div>
  {error&&<div className="notice">{error}</div>}
  {report&&<><section className="report-header panel"><div><h2>{report.programme.name}</h2><p className="muted">{report.programme.code} · {report.programme.status}{report.programme.funder?' · '+report.programme.funder:''}</p></div><span className="badge">{report.suppressed?'FUNDER-SAFE VIEW':'FULL PROGRAMME VIEW'}</span></section>
  <section className="metrics"><article className="metric"><span>Businesses</span><strong>{report.total==null?'—':report.total}</strong><small>{report.suppressed?'privacy threshold applied':'programme total'}</small></article><article className="metric"><span>Score change</span><strong>{report.scoreChange.average==null?'—':(report.scoreChange.average>0?'+':'')+report.scoreChange.average}</strong><small>{report.scoreChange.n??0} businesses re-scored</small></article><article className="metric"><span>Indicators</span><strong>{report.indicators.length}</strong><small>governed targets</small></article><article className="metric"><span>Cohorts</span><strong>{report.cohorts.length}</strong><small>programme cohorts</small></article></section>
  <div className="two-col"><section className="panel"><div className="panel-head"><h2>Case status</h2></div><div className="status-list">{report.byState.map(x=><div key={x.key}><span>{x.key}</span><strong>{x.n==null?'—':x.n}</strong></div>)}</div></section><section className="panel"><div className="panel-head"><h2>Business Health maturity</h2></div><div className="status-list">{report.maturity.map(x=><div key={x.key}><span>{x.key}</span><strong>{x.n==null?'—':x.n}</strong></div>)}</div></section></div>
  <section className="panel"><div className="panel-head"><h2>Average dimension scores</h2></div><div className="indicator-list">{report.dimensions.map((d:any)=><div className="indicator-row" key={d.dimension}><div><h3>{d.dimension}</h3></div><div className="indicator-progress"><strong>{d.avgValue??d.avg_value??'—'}</strong><small>average score</small></div></div>)}</div></section>
  <section className="panel"><div className="panel-head"><h2>Programme indicators</h2></div><div className="status-list">{report.indicators.map((i:any)=><div key={i.id}><span>{i.name}</span><strong>{i.hidden?'—':i.value==null?'No data':String(i.value)+' '+i.unit}</strong></div>)}</div></section></>}
 </main>;
}
