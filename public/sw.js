// Hearth's service worker, so a phone can install the page as an app. It caches no vault content:
// only the list of Hearth servers from Hearth.md (`servers:`), which the page hands it on every load.
// When this server cannot be reached it answers with a small page that tries the others, in
// order, and moves to the first that answers; when none do, it says the hearth is asleep.
const STORE = "hearth-servers";
const GIVE_UP = 5000; // ms before a silent server counts as down, so failover is quick

async function knownServers() {
  try {
    const res = await (await caches.open(STORE)).match("/servers");
    return res ? await res.json() : [];
  } catch {
    return [];
  }
}

const page = (others) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#c4572e"><title>Hearth</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1916;color:#ede5d3;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:16px}
h1{font:600 28px Georgia,serif;margin:0 0 6px}p{color:#8e8a7b;margin:0 0 18px}button{font:inherit;padding:10px 18px;border-radius:999px;border:0;background:#e07a50;color:#fff}</style></head>
<body><main><h1 id="h">🔥 Finding the hearth…</h1><p id="p">This server can't be reached, so trying the others.</p>
<button onclick="location.reload()">Try again</button></main>
<script>
const others = ${JSON.stringify(others)};
const name = (o) => new URL(o).hostname.split(".")[0];
// A cross-origin no-cors fetch of an open file: it resolves when the server is up, whatever it answers.
const alive = (o) => Promise.race([
  fetch(o + "/favicon.svg?ping=" + Date.now(), { mode: "no-cors", cache: "no-store" }).then(() => true, () => false),
  new Promise((r) => setTimeout(() => r(false), ${GIVE_UP})),
]);
(async () => {
  const up = await Promise.all(others.map(alive));
  const next = others[up.indexOf(true)];
  if (next) {
    document.getElementById("h").textContent = "🔥 Moving to " + name(next);
    location.replace(next + location.pathname + location.search + location.hash);
    return;
  }
  document.getElementById("h").textContent = "🔥 The hearth is asleep";
  document.getElementById("p").innerHTML = (others.length ? "None of the Hearth servers can be reached." : "The Mac it lives on can't be reached.") +
    "<br>Check that it is awake, on Tailscale, and that Hearth is running.";
})();
</script></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => {
  if (Array.isArray(e.data?.servers)) e.waitUntil(caches.open(STORE).then((c) => c.put("/servers", Response.json(e.data.servers))));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith((async () => {
    try {
      const timeout = new Promise((_, no) => setTimeout(() => no(new Error("timed out")), GIVE_UP));
      return await Promise.race([fetch(e.request), timeout]);
    } catch {
      const others = (await knownServers()).filter((o) => o !== self.location.origin);
      return new Response(page(others), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
  })());
});
