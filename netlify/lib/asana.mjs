import {AppError,id,normalize,uniqueEntries,taskBudget} from './core.mjs';
const TIME_FIELDS = 'gid,duration_minutes,entered_on,description,billable_status,created_by.gid,created_by.name,attributable_to.gid,attributable_to.name,task.gid,task.name';
const TASK_FIELDS = 'gid,name,custom_fields.gid,custom_fields.name,custom_fields.resource_subtype,custom_fields.display_value,custom_fields.enum_value.name,custom_fields.multi_enum_values.name,custom_fields.text_value,custom_fields.number_value';
export function asanaClient(env = process.env, transport = fetch) {
  const workspace = env.ASANA_WORKSPACE_GID || '1207205268697266';
  async function get(path, params={}) {
    if (!env.ASANA_ACCESS_TOKEN) throw new AppError(503,'Der Asana-Zugang ist serverseitig noch nicht eingerichtet.');
    const url = new URL('https://app.asana.com/api/1.0'+path);
    for (const [key,value] of Object.entries(params)) if(value!=null)url.searchParams.set(key,value);
    for (let attempt=0;attempt<3;attempt++) {
      let res;
      try { res=await transport(url,{headers:{Authorization:`Bearer ${env.ASANA_ACCESS_TOKEN}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)}); }
      catch {throw new AppError(502,'Asana ist momentan nicht erreichbar. Bitte erneut versuchen.');}
      if(res.status===429 && attempt<2) {await new Promise(r=>setTimeout(r,Math.min(30,Number(res.headers.get('retry-after'))||2)*1000));continue;}
      if(!res.ok)throw new AppError(res.status===401||res.status===403?503:502, res.status===429?'Asana begrenzt die Abfragen. Bitte später erneut laden.':'Asana-Abfrage fehlgeschlagen. Bitte Token, Berechtigungen und Projekt prüfen.');
      return res.json();
    }
  }
  async function paged(path,params) {
    const rows=[],seen=new Set();let offset;
    do {const page=await get(path,{...params,limit:100,offset});rows.push(...(page.data||[]));offset=page.next_page?.offset;if(offset && seen.has(offset))throw new AppError(502,'Asana-Paginierung konnte nicht abgeschlossen werden.');if(offset)seen.add(offset);}while(offset);
    return rows;
  }
  async function entries(start,end,project) {
    const raw=await paged('/time_tracking_entries',{...(project?{attributable_to:id(project)}:{workspace}),entered_on_start_date:start,entered_on_end_date:end,opt_fields:TIME_FIELDS});
    return uniqueEntries(raw).map(normalize);
  }
  async function projects(){return [...new Map((await paged(`/workspaces/${id(workspace)}/projects`,{opt_fields:'gid,name,archived'})).map(p=>[p.gid,p])).values()];}
  async function enrich(project,rows,progress=async()=>{}) {
    const fields=await paged(`/projects/${id(project)}/custom_field_settings`,{opt_fields:'custom_field.gid,custom_field.name,custom_field.resource_subtype'});
    const field=fields.map(f=>f.custom_field).find(f=>f?.name?.trim().toLowerCase()==='apenio-budgets') || null;
    if(!field)return {rows:rows.map(r=>({...r,asana_budget:null})),field};
    const ids=[...new Set(rows.map(r=>r.task_gid).filter(Boolean))],values=new Map();
    for(let i=0;i<ids.length;i+=5){await Promise.all(ids.slice(i,i+5).map(async gid=>{const task=await get(`/tasks/${id(gid)}`,{opt_fields:TASK_FIELDS});values.set(gid,taskBudget(task.data||{},field));}));await progress(`Budgetzuordnungen: ${Math.min(i+5,ids.length)} von ${ids.length} Aufgaben geprüft`);}
    return {rows:rows.map(r=>({...r,asana_budget:values.get(r.task_gid)||null})),field};
  }
  return {get,paged,entries,projects,enrich,workspace};
}
