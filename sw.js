const CACHE_NAME = "toko-keuangan-pwa-v1";
const APP_SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/config/firebase.js",
  "./js/modules/auth.js",
  "./js/modules/inventory.js",
  "./js/modules/pos.js",
  "./js/modules/finance.js"
];

// Simpan kerangka aplikasi saat instalasi PWA
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Bersihkan cache versi lama saat update
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      )
    )
  );
  self.clients.claim();
});

// Strategi Network-First dengan Fallback Cache untuk file statis & CDN
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Jangan intervensi koneksi database/auth Firestore (ditangani IndexedDB Firebase)
  if (
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("identitytoolkit.googleapis.com") ||
    url.hostname.includes("securetoken.googleapis.com")
  ) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const cloned = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, cloned));
        }
        return networkRes;
      })
      .catch(() => caches.match(req))
  );
});
