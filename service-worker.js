const CACHE_NAME = "forest-cache-v20";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/main.js",
  "./js/ui.js",
  "./js/player.js",
  "./js/gps.js",
  "./js/audio.js",
  "./js/storage.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
  "./icons/hero-illustration.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // cache.addAll() peut réutiliser une réponse déjà présente dans le cache HTTP du
        // navigateur (donc potentiellement périmée) : on force un vrai aller-retour réseau
        // pour chaque fichier afin de garantir des mises à jour fiables.
        Promise.all(
          APP_SHELL.map((url) =>
            fetch(url, { cache: "reload" }).then((response) => cache.put(url, response))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache d'abord, avec repli réseau ; toujours hors-ligne une fois installé.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
