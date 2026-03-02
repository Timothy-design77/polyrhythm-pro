var CACHE='polypro-v3';
var PRECACHE=[
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js'
];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(PRECACHE)}));
  self.skipWaiting();
});

self.addEventListener('activate',function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch',function(e){
  var url=new URL(e.request.url);
  /* Network-first for same-origin (so deploys arrive immediately) */
  if(url.origin===location.origin){
    e.respondWith(
      fetch(e.request).then(function(resp){
        /* Only cache successful responses - NEVER cache 404s */
        if(resp.ok){
          var clone=resp.clone();
          caches.open(CACHE).then(function(c){c.put(e.request,clone)});
        }
        return resp;
      }).catch(function(){
        return caches.match(e.request).then(function(r){
          /* Fallback: try the registration scope (works on any subdirectory) */
          return r||caches.match(self.registration.scope);
        });
      })
    );
  }else{
    /* Cache-first for CDN assets */
    e.respondWith(
      caches.match(e.request).then(function(r){
        return r||fetch(e.request).then(function(resp){
          if(resp.ok){
            var clone=resp.clone();
            caches.open(CACHE).then(function(c){c.put(e.request,clone)});
          }
          return resp;
        });
      })
    );
  }
});
