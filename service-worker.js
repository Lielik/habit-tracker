// Bump this on every deploy so installed clients pick up new files.
const CACHE_VERSION = "habits-v11";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isFirebaseBackend(url) {
  // Never intercept live Firebase Auth/Firestore network traffic —
  // the SDKs manage their own offline queue/persistence.
  return (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("firebaseapp.com") ||
    url.hostname.includes("google.com")
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (isFirebaseBackend(url)) return; // let these pass through untouched

  const isCdnSdk = url.hostname === "www.gstatic.com";
  const isSameOrigin = url.origin === self.location.origin;

  if (!isCdnSdk && !isSameOrigin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);
      // Cache-first for the SDK (immutable versioned URLs), stale-while-revalidate for app shell.
      if (isCdnSdk && cached) return cached;
      return cached || fetchPromise;
    })
  );
});
