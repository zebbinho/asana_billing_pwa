export const env={TEST_USERNAME:'tester',TEST_PASSWORD:'test-only-password-with-more-than-24-characters'};
export const authorization='Basic '+Buffer.from(`${env.TEST_USERNAME}:${env.TEST_PASSWORD}`).toString('base64');
export function request(path,options={}){return new Request(`http://localhost:8767${path}`,{...options,headers:{authorization,...(options.method==='POST'?{'origin':'http://localhost:8767','Content-Type':'application/json'}:{}),...options.headers}});}
export function memoryStore(){const map=new Map();return {map,json:async k=>map.has(k)?structuredClone(map.get(k)):null,putJSON:async(k,v)=>{map.set(k,structuredClone(v));},bytes:async k=>map.get(k)||null,putBytes:async(k,v)=>{map.set(k,new Uint8Array(v));}};}
export const raw=(gid='e1',date='2026-09-03',minutes=90)=>({gid,entered_on:date,duration_minutes:minutes,created_by:{gid:'u1',name:'Testperson'},task:{gid:'t1',name:'Workshop & Planung'},attributable_to:{gid:'p1',name:'Testkunde'},description:'Abstimmung – nächste Schritte'});
export const settings={project:{customer_name:'Testkunde'},budgets:[{budget_name:'Beratung',commissioned_hours:10}],mappings:{t1:{budget_name:'Beratung',work_package:'Workshop'}}};
