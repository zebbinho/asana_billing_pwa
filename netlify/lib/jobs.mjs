import {asanaClient} from './asana.mjs';
import {emptySettings,preview,reportModel} from './core.mjs';
import {pdfReport,reportFiles} from './pdf.mjs';
export async function performJob(job,store,client=asanaClient()) {
  const progress=async message=>store.putJSON(`jobs/${job.id}`,{...job,state:'running',message});
  const p=job.payload;
  if(job.kind==='range'){
    await progress('Zeitbuchungen und Projektliste werden aus Asana geladen …');
    const [rows,projects]=await Promise.all([client.entries(p.start,p.end),client.projects()]);
    const totals=new Map();for(const r of rows){const t=totals.get(r.project_gid)||{hours:0,entries:0};t.hours+=r.hours;t.entries++;totals.set(r.project_gid,t);}
    return {...p,entries:rows.length,hours:rows.reduce((n,r)=>n+r.hours,0),project_count:projects.length,projects:projects.map(p=>({...p,...(totals.get(p.gid)||{hours:0,entries:0})})).sort((a,b)=>Number(!!a.archived)-Number(!!b.archived)||a.name.localeCompare(b.name,'de'))};
  }
  const settings=job.settings || await store.json(`settings/${p.project_gid}`) || emptySettings();
  await progress(job.kind==='report'?'Kumulierte Leistungen bis zum Berichtsende werden geladen …':'Projektbuchungen werden geladen …');
  const rows=await client.entries(null,p.end,p.project_gid);
  const enriched=await client.enrich(p.project_gid,rows,progress);
  if(job.kind==='preview'){
    const name=rows[0]?.project_name || settings.project?.project_name || (await client.get(`/projects/${p.project_gid}`,{opt_fields:'name'})).data?.name || p.project_gid;
    const result=preview(enriched.rows.filter(r=>r.date>=p.start&&r.date<=p.end),settings,enriched.field,name);
    const model=reportModel(enriched.rows,settings,p,enriched.field);
    result.budgets=result.budgets.map(b=>({...b,...model.budgets.find(x=>x.budget_name===b.budget_name)}));
    return result;
  }
  await progress('PDF und CSV-Nachweise werden erstellt …');
  const model=reportModel(enriched.rows,settings,p,enriched.field);
  model.summary.run_id=job.id;
  const files=reportFiles(model,await pdfReport(model));
  for(const [name,data] of Object.entries(files))await store.putBytes(`reports/${job.id}/${name}`,data);
  return {...model.summary,pdf:`/api/reports/${job.id}/customer_service_report.pdf`,download:`/api/reports/${job.id}/report_package.zip`,preview_renderer:'pdfjs'};
}
export async function finishJob(job,store,client){
  try{const result=await performJob(job,store,client);await store.putJSON(`jobs/${job.id}`,{id:job.id,state:'done',created:job.created,result});}
  catch(error){await store.putJSON(`jobs/${job.id}`,{id:job.id,state:'error',created:job.created,detail:error.status?error.message:'Die Verarbeitung ist fehlgeschlagen. Bitte erneut versuchen.'});}
}
