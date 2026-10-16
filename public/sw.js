// Hearth's service worker, so a phone can install the page as an app. It caches no vault content:
// only the list of Hearth servers from Hearth.md (`servers:`), which the page hands it on every load.
// When this server cannot be reached it answers with a small page that tries the others, in
// order, and moves to the first that answers; when none do, it says the hearth is asleep, lists
// every server with a Connect link, and keeps checking so it moves as soon as one wakes.
const STORE = "hearth-servers";
const GIVE_UP = 5000; // ms before a silent server counts as down, so failover is quick
const RECHECK = 10000; // ms between checks while every server is asleep

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
h1{font:600 28px Georgia,serif;margin:0 0 6px}p{color:#8e8a7b;margin:0 0 18px}button{font:inherit;padding:10px 18px;border-radius:999px;border:0;background:#e07a50;color:#fff}
ul{list-style:none;margin:0 auto 18px;padding:0;max-width:360px;text-align:left}li{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #23302b}
li i{width:9px;height:9px;border-radius:50%;background:#8e8a7b;flex:none}li i.up{background:#7fb069}li i.down{background:#c4572e}
li span{flex:1;min-width:0}li small{display:block;color:#8e8a7b;font-size:13px;overflow:hidden;text-overflow:ellipsis}
li a{color:#e07a50;text-decoration:none;padding:6px 12px;border:1px solid #e07a50;border-radius:999px;font-size:14px}</style></head>
<body><main><h1 id="h">🔥 Finding the hearth…</h1><p id="p">This server can't be reached, so trying the others.</p>
<ul id="list"></ul><button onclick="location.reload()">Try again</button></main>
<script>
const here = location.origin;
const others = ${JSON.stringify(others)};
const name = (o) => new URL(o).hostname.split(".")[0];
const $ = (id) => document.getElementById(id);
// Every server, this one first, each with a Connect link that works whatever its check says.
$("list").innerHTML = [here, ...others].map((o, i) => '<li><i id="d' + i + '"></i><span><strong>' + name(o) + '</strong><small id="s' + i + '">' +
  (o === here ? "this one · not answering" : "checking…") + '</small></span>' +
  (o === here ? "" : '<a href="' + o + location.pathname + location.search + location.hash + '">Connect</a>') + '</li>').join("");
$("d0").className = "down";
// A cross-origin no-cors fetch of an open file: it resolves when the server is up, whatever it answers.
const alive = (o) => Promise.race([
  fetch(o + "/favicon.svg?ping=" + Date.now(), { mode: "no-cors", cache: "no-store" }).then(() => true, () => false),
  new Promise((r) => setTimeout(() => r(false), ${GIVE_UP})),
]);
async function check() {
  const up = await Promise.all(others.map(alive));
  up.forEach((u, i) => { $("d" + (i + 1)).className = u ? "up" : "down"; $("s" + (i + 1)).textContent = u ? "up" : "not answering"; });
  const next = others[up.indexOf(true)];
  if (next) {
    $("h").textContent = "🔥 Moving to " + name(next);
    location.replace(next + location.pathname + location.search + location.hash);
    return;
  }
  // This one may have woken (a Mac back from sleep): reload and it serves the app again.
  if (await alive(here)) { location.reload(); return; }
  $("h").textContent = "🔥 The hearth is asleep";
  $("p").innerHTML = (others.length ? "None of the Hearth servers can be reached." : "The Mac it lives on can't be reached.") +
    "<br>Check that it is awake, on Tailscale, and that Hearth is running. Still checking every ${RECHECK / 1000} seconds.";
  setTimeout(check, ${RECHECK});
}
check();
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
