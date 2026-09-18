import {getStore} from '@netlify/blobs';
export function storage() {
  // Stable across deploys; preview deployments use separate stores.
  const context=process.env.CONTEXT || 'dev';
  const name=context==='production'?'apenio-billing':`apenio-billing-${context}-${(process.env.BRANCH||'local').replace(/[^a-z0-9-]/gi,'-').slice(0,60)}`;
  const store=getStore({name,consistency:'strong'});
  return {
    json:key=>store.get(key,{type:'json'}),
    putJSON:(key,value)=>store.setJSON(key,value),
    bytes:async key=>{const data=await store.get(key,{type:'arrayBuffer'});return data===null?null:new Uint8Array(data);},
    putBytes:(key,data)=>store.set(key,new Blob([data])),
  };
}
