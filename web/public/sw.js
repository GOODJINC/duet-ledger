const CACHE='duet-ledger-shell-'+(new URL(self.location.href).searchParams.get('v')||'v3');
const APP_PATHS=new Set(['/','/home','/ledger','/stats','/accounts','/settings','/account','/admin']);
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);const response=await fetch('/',{cache:'reload'});
  if(!response.ok)throw new Error('Shell unavailable');
  const html=await response.clone().text();await cache.put('/',response);
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(m=>m[1]);
  await cache.addAll([...new Set([...assets,'/icon.svg','/icon-192.png','/icon-512.png'])]);
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('duet-ledger-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/healthz'||url.pathname==='/mcp')return;
 if(event.request.mode==='navigate'&&APP_PATHS.has(url.pathname.replace(/\/$/,'')||'/')){
  event.respondWith((async()=>{
   try{const response=await fetch(event.request);if(response.status<500)return response;}
   catch{}
   return await caches.match('/')||new Response('Offline',{status:503});
  })());return;
 }
 if(url.pathname.startsWith('/assets/')||url.pathname==='/icon.svg')event.respondWith((async()=>{
  const cache=await caches.open(CACHE);const hit=await cache.match(event.request);if(hit)return hit;
  const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;
 })());
});
