export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value)) throw new AppError(400, 'Ungültige Kennung.');
  return value;
};
export function range(start, end) {
  for (const value of [start, end]) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new AppError(400, 'Bitte gültige Von/Bis-Daten angeben.');
  }
  if (start > end) throw new AppError(400, 'Von darf nicht nach Bis liegen.');
  return {start, end};
}
export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) throw new AppError(400, 'Monat muss YYYY-MM sein.');
  const [year, m] = month.split('-').map(Number);
  return range(`${month}-01`, `${month}-${new Date(Date.UTC(year, m, 0)).getUTCDate()}`);
}
export function resolveRange(p) { return p.start && p.end ? range(p.start, p.end) : monthBounds(p.month); }
export function normalize(e) {
  const minutes = Number(e.duration_minutes ?? 0);
  if (!Number.isFinite(minutes)) throw new AppError(422, 'Eine Zeitbuchung enthält ungültige Minuten.');
  return {time_entry_gid:e.gid, date:e.entered_on, employee_gid:e.created_by?.gid ?? null, employee_name:e.created_by?.name || 'UNBEKANNT', project_gid:e.attributable_to?.gid ?? null, project_name:e.attributable_to?.name || 'OHNE PROJEKT-ZUORDNUNG', task_gid:e.task?.gid ?? null, task_name:e.task?.name || 'OHNE TASK-ZUORDNUNG', description:String(e.description || '').trim(), minutes, hours:minutes/60, billable_status:e.billable_status || 'notSpecified'};
}
export function uniqueEntries(entries) {
  const seen = new Set();
  return entries.filter(e => { if (!e.gid) throw new AppError(422, 'Zeitbuchung ohne Kennung.'); if (seen.has(e.gid)) return false; seen.add(e.gid); return true; });
}
export function fieldValue(f) {
  if (f.display_value != null && String(f.display_value).trim()) return String(f.display_value).trim();
  if (f.enum_value?.name) return f.enum_value.name;
  if (f.multi_enum_values?.length) return f.multi_enum_values.map(v=>v.name).filter(Boolean).join(', ') || null;
  if (f.text_value) return String(f.text_value).trim() || null;
  return f.number_value == null ? null : String(f.number_value);
}
export function taskBudget(task, field) {
  if (!field) return null;
  const fields = task.custom_fields || [];
  const match = fields.find(f => field.gid && f.gid === field.gid) || fields.find(f => f.name?.trim().toLowerCase() === 'apenio-budgets');
  return match ? fieldValue(match) : null;
}
export const emptySettings = () => ({project:null, budgets:[], mappings:{}});
export function savedSettings(project, payload, previous = emptySettings()) {
  if (!Array.isArray(payload.budgets) || !Array.isArray(payload.mappings) || typeof payload.customer_name !== 'string') throw new AppError(400, 'Unvollständige Konfiguration.');
  const names = new Set();
  const budgets = payload.budgets.map(b => {
    const name = String(b.budget_name || '').trim();
    if (!name || names.has(name) || typeof b.commissioned_hours !== 'number' || !Number.isFinite(b.commissioned_hours) || b.commissioned_hours < 0) throw new AppError(400, 'Budgets benötigen eindeutige Namen und nicht negative Stunden.');
    names.add(name); return {project_gid:project, budget_name:name, commissioned_hours:b.commissioned_hours};
  });
  const mappings = {...previous.mappings};
  for (const m of payload.mappings) mappings[id(m.task_gid)] = {project_gid:project, task_gid:m.task_gid, task_name:String(m.task_name || ''), budget_name:String(m.budget_name || '').trim(), work_package:String(m.work_package || '')};
  return {project:{project_gid:project, customer_name:payload.customer_name, project_name:String(payload.project_name || '')}, budgets, mappings};
}
export function preview(rows, settings, field, projectName) {
  const tasks = new Map();
  for (const r of rows) {
    if (!r.task_gid) continue;
    const t = tasks.get(r.task_gid) || {task_gid:r.task_gid, task_name:r.task_name, hours:0, mapping:settings.mappings[r.task_gid] || null, asana_budget:r.asana_budget};
    t.hours += r.hours; tasks.set(r.task_gid, t);
  }
  const budgets = effectiveBudgets(settings.budgets,field);
  for (const name of new Set(rows.map(r=>r.asana_budget).filter(Boolean))) if (!budgets.some(b=>b.budget_name===name)) budgets.push({budget_name:name, commissioned_hours:0, auto_discovered:true});
  const list = [...tasks.values()].sort((a,b)=>a.task_name.localeCompare(b.task_name,'de'));
  return {project_name:projectName, customer_name:settings.project?.customer_name || '', hours:rows.reduce((n,r)=>n+r.hours,0), entries:rows.length, missing_task:rows.filter(r=>!r.task_gid).length, missing_project:rows.filter(r=>!r.project_gid).length, tasks:list, budgets, budget_field:field, auto_budget_tasks:list.filter(t=>t.asana_budget).length, unmapped_budget_tasks:list.filter(t=>!t.asana_budget && (!t.mapping?.budget_name || t.mapping.budget_name==='UNASSIGNED')).length};
}
export function reportModel(rows, settings, payload, field) {
  const {start,end} = resolveRange(payload);
  if (rows.some(r=>r.minutes<0 || !r.date || r.date>end)) throw new AppError(422, 'Negative Zeiten oder unpassende Buchungsdaten gefunden. Bitte in Asana prüfen.');
  const enrich = r => {
    const mapping = settings.mappings[r.task_gid] || {};
    const budget = r.asana_budget || mapping.budget_name || 'UNASSIGNED';
    return {...r, budget_name:budget, budget_source:r.asana_budget?'asana':(mapping.budget_name && budget!=='UNASSIGNED'?'local_fallback':'unassigned'), work_package:mapping.work_package || r.task_name, comment:r.description || r.task_name};
  };
  const cumulative = rows.map(enrich);
  const lines = cumulative.filter(r=>r.date>=start && r.date<=end);
  const definitions = new Map(effectiveBudgets(settings.budgets,field).map(b=>[b.budget_name,b.commissioned_hours]));
  const delivered = new Map();
  for (const r of cumulative) if (r.billable_status!=='nonBillable') delivered.set(r.budget_name,(delivered.get(r.budget_name)||0)+r.hours);
  const budgets = [...new Set([...definitions.keys(),...delivered.keys()])].sort().map(name=>({budget_name:name,commissioned_hours:definitions.get(name)||0,delivered_hours:delivered.get(name)||0,remaining_hours:(definitions.get(name)||0)-(delivered.get(name)||0)}));
  const customer = payload.customer_name || settings.project?.customer_name || rows[0]?.project_name || payload.project_gid;
  const summary = {customer,start,end,project_gid:payload.project_gid,entries:lines.length,monthly_hours:lines.reduce((n,r)=>n+r.hours,0),cumulative_hours:cumulative.reduce((n,r)=>n+r.hours,0),unassigned_monthly:lines.filter(r=>r.budget_name==='UNASSIGNED').length,unassigned_cumulative:cumulative.filter(r=>r.budget_name==='UNASSIGNED').length,missing_task:cumulative.filter(r=>!r.task_gid).length,missing_project:cumulative.filter(r=>!r.project_gid).length,budget_field:field,auto_budget_monthly:lines.filter(r=>r.budget_source==='asana').length};
  return {customer,start,end,lines,budgets,summary};
}

export function commissionedBudgets(tasks, field) {
  const totals=new Map(),seen=new Set(),target=field.commissioned_field?.gid;
  for(const task of tasks){
    if(seen.has(task.gid))continue;seen.add(task.gid);
    const value=task.custom_fields?.find(f=>f.gid===target)?.number_value;
    if(value==null)continue;
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new AppError(422,'Ungültige Stunden in Beauftragt (h). Bitte in Asana korrigieren.');
    const name=taskBudget(task,field);
    if(!name)throw new AppError(422,'Eine Aufgabe mit Beauftragt (h) hat keine Budgetzuordnung. Bitte in Asana ergänzen.');
    totals.set(name,(totals.get(name)||0)+value);
  }
  return [...totals].map(([budget_name,commissioned_hours])=>({budget_name,commissioned_hours,source:'asana'}));
}
export function effectiveBudgets(budgets,field){
  const result=new Map(budgets.map(b=>[b.budget_name,b]));
  for(const b of field?.commissioned_budgets||[])result.set(b.budget_name,b);
  return [...result.values()];
}
