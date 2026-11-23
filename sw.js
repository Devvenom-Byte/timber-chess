const CACHE='timber-chess-v6';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./fonts/fraunces.woff2','./fonts/inter.woff2','./privacy.html','./board3d.js'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  const u=new URL(r.url);
  if(u.origin!==location.origin) return; // everything the app needs is on this site; the game database is never cached
  if(r.mode==='navigate'){
    // Network first so updates arrive; only a real, successful copy of the app is saved for offline use
    // (never an error page, a 404 or a Wi-Fi login page).
    const isApp=/\/(index\.html)?$/.test(u.pathname);
    e.respondWith(fetch(r).then(res=>{
      if(isApp&&res.ok&&res.type==='basic'&&!res.redirected&&(res.headers.get('content-type')||'').includes('text/html')){ const cp=res.clone(); caches.open(CACHE).then(c=>c.put('./index.html',cp)); }
      return res;
    }).catch(()=>caches.match(isApp?'./index.html':r).then(m=>m||caches.match('./index.html'))));
    return;
  }
  // Files: from the cache when we have them; otherwise download and keep a copy (e.g. the 3D library the
  // first time 3D is switched on), so they work offline afterwards.
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(m=>m||fetch(r).then(res=>{
    if(res.ok&&res.type==='basic'){ const cp=res.clone(); caches.open(CACHE).then(c=>c.put(r,cp)); }
    return res;
  })));
});
