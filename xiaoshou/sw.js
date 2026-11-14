const CACHE="xiaoshou-v1";
const FILES=["./","./index.html","./xs.js","./manifest.webmanifest","./icon-192.png","./icon-512.png","./apple-touch-icon.png","../catalog.js","../exceljs.min.js","../lib/firebase-app-compat.js","../lib/firebase-auth-compat.js","../lib/firebase-firestore-compat.js","../lib/cloud.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("xiaoshou-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("./index.html"))))});
