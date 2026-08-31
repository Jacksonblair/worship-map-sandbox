// Minimal pass-through service worker -- exists only to satisfy Chrome's
// PWA installability criteria (manifest + HTTPS + a fetch-handling SW),
// not for offline caching. Same file will be needed as-is for the later
// Bubblewrap/TWA packaging step.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
