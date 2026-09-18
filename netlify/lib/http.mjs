import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {authenticate,securityHeaders,jobSignature} from './auth.mjs';
import {AppError,id,resolveRange,emptySettings,savedSettings} from './core.mjs';
import {storage} from './storage.mjs';
import {asanaClient} from './asana.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:securityHeaders});
const FILES=new Set(['customer_service_report.pdf','report_package.zip','01_time_entries_raw.csv','03_billing_lines.csv','04_budget_summary.csv','run_summary.json']);
async function body(request){if(Number(request.headers.get('content-length')||0)>1_000_000)throw new AppError(413,'Die Anfrage ist zu groß.');const text=await request.text();if(text.length>1_000_000)throw new AppError(413,'Die Anfrage ist zu groß.');try{return JSON.parse(text)}catch{throw new AppError(400,'Ungültige Eingabe.')}}
export async function handle(request,options={}) {
  const env=options.env||process.env,denied=authenticate(request,env);
  if(denied)return denied;
  try{
    const url=new URL(request.url),path=url.pathname.replace(/^\/\.netlify\/functions\/billing(?=\/|$)/,'')||'/';
    const getStore=()=>options.store||storage();
    if(path==='/api/status' && request.method==='GET'){
      const client=options.client||asanaClient(env);const me=await client.get('/users/me');return json({ok:true,user:me.data?.name,workspace_gid:client.workspace,workspace_name:env.ASANA_WORKSPACE_NAME||'apenio GmbH',hosting:'netlify'});
    }
    let match;
    if((match=path.match(/^\/api\/jobs\/([a-f0-9-]+)$/)) && request.method==='GET'){
      const job=await getStore().json(`jobs/${match[1]}`);if(!job)throw new AppError(404,'Auftrag nicht gefunden.');
      if(job.state==='done')return json(job.result);
      if(job.state==='error')throw new AppError(502,job.detail);
      if(Date.now()-job.created>16*60*1000)throw new AppError(504,'Die Verarbeitung hat zu lange gedauert. Bitte erneut versuchen.');
      return json({pending:true,poll_url:path,message:job.message||'Auftrag wartet auf Verarbeitung …'},202);
    }
    if((match=path.match(/^\/api\/project\/([^/]+)\/save$/)) && request.method==='POST'){
      const project=id(match[1]),payload=await body(request),store=getStore();
      const previous=await store.json(`settings/${project}`)||emptySettings();
      await store.putJSON(`settings/${project}`,savedSettings(project,payload,previous));return json({ok:true});
    }
    if((match=path.match(/^\/api\/reports\/([a-f0-9-]+)\/([^/]+)$/)) && request.method==='GET'){
      if(!FILES.has(match[2]))throw new AppError(404,'Datei nicht gefunden.');
      const data=await getStore().bytes(`reports/${match[1]}/${match[2]}`);if(!data)throw new AppError(404,'Datei nicht gefunden.');
      const types={'.pdf':'application/pdf','.zip':'application/zip','.csv':'text/csv; charset=utf-8','.json':'application/json'};
      // Streaming avoids buffering binary responses into Netlify's JSON response envelope.
      const stream=new ReadableStream({start(controller){controller.enqueue(data);controller.close();}});
      return new Response(stream,{headers:{...securityHeaders,'Content-Type':types[extname(match[2])],'Content-Disposition':`${url.searchParams.get('inline')==='true'&&match[2].endsWith('.pdf')?'inline':'attachment'}; filename="${match[2]}"`}});
    }
    let kind,payload;
    if(path==='/api/range' && request.method==='GET'){kind='range';payload=resolveRange(Object.fromEntries(url.searchParams));}
    else if((match=path.match(/^\/api\/project\/([^/]+)\/preview$/)) && request.method==='GET'){kind='preview';payload={...resolveRange(Object.fromEntries(url.searchParams)),project_gid:id(match[1])};}
    else if(path==='/api/report/generate' && request.method==='POST'){const b=await body(request);kind='report';payload={...resolveRange(b),project_gid:id(b.project_gid),customer_name:typeof b.customer_name==='string'?b.customer_name:''};}
    if(kind){
      const store=getStore(),job={id:randomUUID(),kind,payload,state:'pending',created:Date.now()};
      // Snapshot report settings: another tester cannot alter this running report's budgets.
      if(kind==='report')job.settings=await store.json(`settings/${payload.project_gid}`)||emptySettings();
      await store.putJSON(`jobs/${job.id}`,job);
      try{
        if(options.dispatch)await options.dispatch(job);
        else {
          const res=await fetch(new URL('/.netlify/functions/billing-background',request.url),{method:'POST',headers:{'Content-Type':'application/json','x-billing-job-signature':jobSignature(job.id,env)},body:JSON.stringify({id:job.id}),signal:AbortSignal.timeout(15000),redirect:'error'});
          if(res.status!==202)throw new Error('dispatch');
        }
      }catch{await store.putJSON(`jobs/${job.id}`,{...job,state:'error',detail:'Hintergrundverarbeitung konnte nicht gestartet werden. Bitte Netlify-Konfiguration prüfen.'});throw new AppError(503,'Hintergrundverarbeitung konnte nicht gestartet werden. Bitte erneut versuchen.');}
      return json({pending:true,poll_url:`/api/jobs/${job.id}`,message:'Auftrag gestartet …'},202);
    }
    if(path.startsWith('/api/'))throw new AppError(404,'Funktion nicht gefunden.');
    if(request.method!=='GET'&&request.method!=='HEAD')throw new AppError(405,'Methode nicht unterstützt.');
    const root=resolve(options.siteRoot||'netlify/site'),file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!file.startsWith(root+sep))throw new AppError(404,'Seite nicht gefunden.');
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf','.wasm':'application/wasm'};
    if(!types[extname(file)])throw new AppError(404,'Seite nicht gefunden.');
    let data;try{data=await readFile(file)}catch{throw new AppError(404,'Seite nicht gefunden.')}
    return new Response(request.method==='HEAD'?null:data,{headers:{...securityHeaders,'Content-Type':types[extname(file)]}});
  }catch(error){return json({detail:error instanceof AppError?error.message:'Die Anfrage konnte nicht verarbeitet werden. Bitte erneut versuchen.'},error instanceof AppError?error.status:500);}
}
