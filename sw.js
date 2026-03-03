var CACHE='polypro-v12-0';
var CDN_URLS=[
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js'
];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(CDN_URLS)}));
  self.skipWaiting();
});

self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}));
  }));
  self.clients.claim();
});

self.addEventListener('fetch',function(e){
  var url=e.request.url;
  /* Network-first for own pages — always get latest version */
  if(url.indexOf('unpkg.com')<0&&url.indexOf('cdnjs.cloudflare.com')<0){
    e.respondWith(
      fetch(e.request).then(function(resp){
        if(resp.status===200){
          var clone=resp.clone();
          caches.open(CACHE).then(function(c){c.put(e.request,clone)});
        }
        return resp;
      }).catch(function(){return caches.match(e.request).then(function(r){return r||caches.match('/index.html')})})
    );
  } else {
    /* Cache-first for CDN assets — they never change */
    e.respondWith(
      caches.match(e.request).then(function(r){
        return r||fetch(e.request).then(function(resp){
          if(resp.status===200){var clone=resp.clone();caches.open(CACHE).then(function(c){c.put(e.request,clone)})}
          return resp;
        });
      })
    );
  }
});
