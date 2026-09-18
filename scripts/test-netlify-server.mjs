// Isolated browser test server: synthetic data, in-memory persistence, loopback only.
// Never used by netlify.toml or the production entrypoints.
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {handle} from '../netlify/lib/http.mjs';
import {finishJob} from '../netlify/lib/jobs.mjs';
import {normalize} from '../netlify/lib/core.mjs';
import {env,authorization,memoryStore,raw,settings} from '../tests/netlify/helpers.mjs';
const store=memoryStore();await store.putJSON('settings/p1',settings);
const delay=()=>new Promise(r=>setTimeout(r,600));
const client={workspace:'test',get:async()=>({data:{name:'TESTDATEN – kein Asana-Zugriff'}}),projects:async()=>[{gid:'p1',name:'Testkunde'},{gid:'p2',name:'Kunde ohne Buchungen'}],entries:async(start)=>{await delay();return [...(!start?[normalize(raw('old','2026-08-01',60))]:[]),normalize(raw())]},enrich:async(p,rows,progress)=>{await progress('Testdaten: Budgetzuordnungen werden geprüft …');await delay();return {rows,field:{gid:'budget',name:'apenio-Budgets',commissioned_field:{gid:'hours',name:'Beauftragt (h)'},commissioned_budgets:[{budget_name:'Beratung',commissioned_hours:16,source:'asana'}]}}}};
createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const c of req)chunks.push(c);
    const headers=new Headers(req.headers);headers.set('authorization',authorization);
    const request=new Request(`http://127.0.0.1:8767${req.url}`,{method:req.method,headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)})});
    const response=await handle(request,{env,store,client,dispatch:async job=>{void finishJob(job,store,client)}});
    res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch{res.writeHead(500);res.end('Test server error');}
}).listen(8767,'127.0.0.1',()=>console.log('Synthetic Netlify test on http://127.0.0.1:8767'));
