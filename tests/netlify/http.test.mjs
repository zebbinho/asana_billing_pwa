import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../../netlify/lib/http.mjs';
import {workerAllowed,jobSignature} from '../../netlify/lib/auth.mjs';
import {finishJob} from '../../netlify/lib/jobs.mjs';
import {normalize} from '../../netlify/lib/core.mjs';
import {env,request,memoryStore,raw,settings} from './helpers.mjs';
test('Fail closed: fehlende Konfiguration, Seiten, API und Direkt-Downloads',async()=>{
  assert.equal((await handle(request('/'),{env:{}})).status,503);
  for(const path of ['/','/app.js','/api/range','/api/reports/abc/customer_service_report.pdf','/.netlify/functions/billing/api/status']){const res=await handle(new Request('https://example.test'+path),{env});assert.equal(res.status,401);assert.match(res.headers.get('www-authenticate'),/^Basic/);}
});
test('Origin-Prüfung und sichere Fehlerantwort',async()=>{const res=await handle(request('/api/project/p1/save',{method:'POST',headers:{origin:'https://other.test'},body:'{}'}),{env});assert.equal(res.status,403);});
test('Statische Oberfläche erreichbar, .env und Sourcecode gesperrt',async()=>{assert.equal((await handle(request('/'),{env})).status,200);for(const path of ['/.env','/netlify.toml','/app/main.py'])assert.equal((await handle(request(path),{env})).status,404);});
test('Hintergrundauftrag liefert Fortschritt und vollständiges Ergebnis',async()=>{
  const store=memoryStore();let queued;
  const res=await handle(request('/api/range?start=2026-09-01&end=2026-09-30'),{env,store,dispatch:async j=>{queued=j}});assert.equal(res.status,202);const pending=await res.json();
  assert.equal((await (await handle(request(pending.poll_url),{env,store})).json()).pending,true);
  const client={entries:async()=>[normalize(raw())],projects:async()=>[{gid:'p1',name:'Testkunde'},{gid:'p2',name:'Ohne Buchung'}]};
  await finishJob(queued,store,client);const done=await(await handle(request(pending.poll_url),{env,store})).json();assert.equal(done.hours,1.5);assert.equal(done.projects[0].entries+done.projects[1].entries,1);assert.equal(done.projects.find(p=>p.gid==='p2').hours,0);
});
test('Aufträge haben getrennte IDs und unveränderte Budget-Snapshots',async()=>{const store=memoryStore();await store.putJSON('settings/p1',settings);const created=[];for(let i=0;i<2;i++)await handle(request('/api/report/generate',{method:'POST',body:JSON.stringify({project_gid:'p1',month:'2026-09'})}),{env,store,dispatch:async j=>created.push(j)});assert.notEqual(created[0].id,created[1].id);await store.putJSON('settings/p1',{...settings,budgets:[]});assert.equal(created[0].settings.budgets.length,1);});
test('Worker-Signatur ist auf einen konkreten Auftrag beschränkt',()=>{const req=new Request('https://example.test',{headers:{'x-billing-job-signature':jobSignature('a',env)}});assert.ok(workerAllowed(req,'a',env));assert.equal(workerAllowed(req,'b',env),false);});
test('Fehlgeschlagene Aufträge bleiben verständlich abrufbar',async()=>{const store=memoryStore(),job={id:'abc',kind:'range',created:Date.now(),payload:{}};await finishJob(job,store,{entries:async()=>{throw new Error('secret')},projects:async()=>[]});const response=await handle(request('/api/jobs/abc'),{env,store});assert.equal(response.status,502);assert.ok(!(await response.text()).includes('secret'));});
