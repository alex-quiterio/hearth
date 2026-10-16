// Hearth's service worker, so a phone can install the page as an app. It caches nothing: the
// vault stays on the Mac. When the Mac cannot be reached it answers with a small page instead
// of the browser's error.
const ASLEEP = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#c4572e"><title>Hearth</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1916;color:#ede5d3;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:16px}
h1{font:600 28px Georgia,serif;margin:0 0 6px}p{color:#8e8a7b;margin:0 0 18px}button{font:inherit;padding:10px 18px;border-radius:999px;border:0;background:#e07a50;color:#fff}</style></head>
<body><main><h1>🔥 The hearth is asleep</h1><p>The Mac it lives on can't be reached.<br>Check that it is awake, on Tailscale, and that Hearth is running.</p>
<button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(ASLEEP, { headers: { "content-type": "text/html; charset=utf-8" } })));
});
