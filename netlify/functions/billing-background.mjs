import {storage} from '../lib/storage.mjs';
import {workerAllowed} from '../lib/auth.mjs';
import {finishJob} from '../lib/jobs.mjs';
export default async request=>{
  if(request.method!=='POST')return;
  let input;try{input=await request.json()}catch{return}
  if(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||!workerAllowed(request,input.id))return;
  const store=storage(),job=await store.json(`jobs/${input.id}`);
  if(!job||job.state==='done'||job.state==='error'||Date.now()-job.created>15*60*1000)return;
  await finishJob(job,store);
};
export const config={background:true};
