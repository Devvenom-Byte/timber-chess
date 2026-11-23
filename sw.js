const CACHE='timber-chess-v2';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  const u=new URL(r.url);
  if(u.origin===location.origin){
    if(r.mode==='navigate'){
      // Always try the network first so updates arrive; only a real, successful copy of the app is saved for
      // offline use (never an error page, a 404 or a Wi-Fi login page).
      e.respondWith(fetch(r).then(res=>{
        if(res.ok&&res.type==='basic'&&!res.redirected&&(res.headers.get('content-type')||'').includes('text/html')){ const cp=res.clone(); caches.open(CACHE).then(c=>c.put('./index.html',cp)); }
        return res;
      }).catch(()=>caches.match('./index.html')));
      return;
    }
    e.respondWith(caches.match(r).then(m=>m||fetch(r)));
    return;
  }
  // Fonts and pinned library files from CDNs: serve from cache, refresh in the background.
  if(/^(cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname)){
    e.respondWith(caches.open(CACHE).then(c=>c.match(r).then(m=>{
      const f=fetch(r).then(res=>{ if(res.ok||res.type==='opaque') c.put(r,res.clone()); return res; });
      return m?(f.catch(()=>m),m):f;
    })));
  }
});
