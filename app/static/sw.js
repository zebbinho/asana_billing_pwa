const CACHE='asana-billing-ci-v6';
const ASSETS=['/','/style.css?v=6','/app.js?v=6','/manifest.webmanifest','/brand/apenio-logo.png','/brand/source-sans-pro-regular.woff2','/brand/source-sans-pro-semibold.woff2','/brand/source-sans-pro-light-italic.woff2'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('asana-billing-')&&k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request)))});

