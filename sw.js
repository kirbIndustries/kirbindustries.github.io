const CACHE_NAME = 'dropshare-cache-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './favicon.png',
    'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,700,1,0'
];

// Install: Cache critical static assets immediately
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

// Activate: Clean up old cache versions and claim clients
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME && key !== 'dropshare-shared-cache') {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Stale-while-revalidate for assets + Web Share Target POST handler
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. Intercept Web Share Target POST requests with files
    if (event.request.method === 'POST') {
        event.respondWith((async () => {
            try {
                const formData = await event.request.formData();
                const files = formData.getAll('files');
                if (files && files.length > 0) {
                    const shareCache = await caches.open('dropshare-shared-cache');
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        await shareCache.put(
                            `./shared-file-${Date.now()}-${i}/${encodeURIComponent(file.name)}`,
                            new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } })
                        );
                    }
                }
            } catch (err) {
                console.error('[SW] Share target error:', err);
            }
            // Redirect back to app home
            return Response.redirect('./index.html', 303);
        })());
        return;
    }

    // 2. Ignore non-HTTP/HTTPS schemes (e.g. chrome-extension://, blob:) and WebSocket traffic
    if (!url.protocol.startsWith('http')) {
        return;
    }

    // 3. Stale-While-Revalidate caching strategy
    event.respondWith((async () => {
        const cachedResponse = await caches.match(event.request);

        const fetchPromise = fetch(event.request).then(async (networkResponse) => {
            if (
                networkResponse &&
                networkResponse.status === 200 &&
                (event.request.url.startsWith(self.location.origin) ||
                 event.request.url.includes('cdnjs.cloudflare.com') ||
                 event.request.url.includes('fonts.googleapis.com') ||
                 event.request.url.includes('fonts.gstatic.com') ||
                 event.request.url.includes('esm.sh'))
            ) {
                const cache = await caches.open(CACHE_NAME);
                cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
        }).catch(() => {
            // Fallback for page navigation when offline
            if (event.request.mode === 'navigate') {
                return caches.match('./index.html');
            }
        });

        return cachedResponse || fetchPromise;
    })());
});