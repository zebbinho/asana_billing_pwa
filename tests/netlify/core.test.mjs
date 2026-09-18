import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,uniqueEntries,monthBounds,range,taskBudget,savedSettings,reportModel} from '../../netlify/lib/core.mjs';
import {asanaClient} from '../../netlify/lib/asana.mjs';
import {raw,settings} from './helpers.mjs';
test('Schaltjahr, Monatsgrenzen und ungültige Datumswerte',()=>{assert.deepEqual(monthBounds('2024-02'),{start:'2024-02-01',end:'2024-02-29'});assert.equal(range('2026-12-15','2027-01-15').end,'2027-01-15');assert.throws(()=>range('2026-02-30','2026-03-01'));assert.throws(()=>range('2026-10-01','2026-09-01'));});
test('Null-Zuordnungen bleiben erhalten; Dedup erfolgt nach GID',()=>{const r=normalize({...raw(),task:null,attributable_to:null});assert.equal(r.hours,1.5);assert.equal(r.task_name,'OHNE TASK-ZUORDNUNG');assert.equal(r.project_name,'OHNE PROJEKT-ZUORDNUNG');assert.equal(uniqueEntries([raw(),raw()]).length,1);});
test('Budgetfeld wird per GID vor Namen ausgewählt',()=>{const task={custom_fields:[{gid:'wrong',name:'apenio-Budgets',display_value:'Falsch'},{gid:'right',name:'Umbenannt',enum_value:{name:'Beratung'}}]};assert.equal(taskBudget(task,{gid:'right'}),'Beratung');assert.equal(taskBudget(task,null),null);});
test('Monatsdetails und kumulierte Budgets; Asana schlägt Fallback',()=>{const rows=[normalize(raw('old','2026-08-01',60)),{...normalize(raw()),asana_budget:'Asana-Budget'},normalize({...raw('free'),billable_status:'nonBillable'})];const model=reportModel(rows,settings,{project_gid:'p1',month:'2026-09'},null);assert.equal(model.lines.length,2);assert.equal(model.lines[0].budget_source,'asana');assert.equal(model.budgets.find(b=>b.budget_name==='Beratung').delivered_hours,1);assert.equal(model.budgets.find(b=>b.budget_name==='Asana-Budget').delivered_hours,1.5);assert.equal(model.summary.monthly_hours,3);});
test('Speichern erhält Mappings älterer Monate und lehnt doppelte Budgets ab',()=>{const result=savedSettings('p1',{customer_name:'Kunde',budgets:[],mappings:[]},settings);assert.ok(result.mappings.t1);assert.throws(()=>savedSettings('p1',{customer_name:'Kunde',budgets:[{budget_name:'A',commissioned_hours:1},{budget_name:'A',commissioned_hours:2}],mappings:[]}));});
test('Asana paginiert mit maximal 100 und dedupliziert Zeitbuchungen',async()=>{let calls=0;const client=asanaClient({ASANA_ACCESS_TOKEN:'test-token'},async url=>{assert.equal(url.searchParams.get('limit'),'100');calls++;return Response.json(calls===1?{data:[raw()],next_page:{offset:'page2'}}:{data:[raw(),raw('e2')],next_page:null});});assert.equal((await client.entries('2026-09-01','2026-09-30')).length,2);assert.equal(calls,2);});
test('Asana-Fehler enthalten keine Upstream- oder Tokeninformationen',async()=>{const client=asanaClient({ASANA_ACCESS_TOKEN:'secret-test'},async()=>Response.json({errors:[{message:'secret-test'}]},{status:403}));await assert.rejects(client.get('/users/me'),e=>!e.message.includes('secret-test'));});

import {commissionedBudgets,effectiveBudgets} from '../../netlify/lib/core.mjs';
const commissionedField={gid:'budget',commissioned_field:{gid:'hours'}};
const budgetTask=(gid,value,name='Beratung')=>({gid,custom_fields:[{gid:'hours',number_value:value},{gid:'budget',display_value:name}]});
test('Beauftragt: einmal pro Task, null fehlt, 0 überschreibt lokalen Wert',()=>{
 const actual=commissionedBudgets([budgetTask('a',12),budgetTask('b',4),budgetTask('a',12),budgetTask('c',0,'Zero'),budgetTask('d',null)],commissionedField);
 assert.deepEqual(actual.map(b=>b.commissioned_hours),[16,0]);
 const field={...commissionedField,commissioned_budgets:actual};
 assert.equal(effectiveBudgets([{budget_name:'Zero',commissioned_hours:99}],field).find(b=>b.budget_name==='Zero').commissioned_hours,0);
 const model=reportModel([normalize(raw('old','2026-08-01',60)),normalize(raw())],settings,{project_gid:'p1',month:'2026-09'},field);
 assert.equal(model.budgets[0].commissioned_hours,16);assert.equal(model.budgets[0].delivered_hours,2.5);assert.equal(model.budgets[0].remaining_hours,13.5);
 assert.equal(model.budgets.find(b=>b.budget_name==='Zero').delivered_hours,0);
});
test('Beauftragt: ungültige Stunden oder fehlende Zuordnung blockieren',()=>{
 for(const task of [budgetTask('a',-1),budgetTask('a',NaN),budgetTask('a',3,null)])assert.throws(()=>commissionedBudgets([task],commissionedField));
});
test('Asana lädt auch Budgetaufgaben ohne Buchungen und erkennt AI-Budgets',async()=>{
 let requested=false;
 const client=asanaClient({ASANA_ACCESS_TOKEN:'test'},async url=>{
  if(url.pathname.endsWith('custom_field_settings'))return Response.json({data:[{custom_field:{gid:'budget',name:'apenio-AI-Budgets'}},{custom_field:{gid:'hours',name:'Beauftragt (h)'}}]});
  assert.ok(url.pathname.endsWith('/projects/p1/tasks'));requested=true;
  return Response.json({data:[budgetTask('budget-only',40)]});
 });
 const result=await client.enrich('p1',[]);assert.ok(requested);assert.equal(result.field.commissioned_budgets[0].commissioned_hours,40);
});
