// Hearth frontend: renders /api/state, streams /api/chat. No build step.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const day = (d) => (d ? String(d).slice(0, 10) : "");
const PLACE_ICON = { here: "🏙️", land: "🌳", lisbon: "🌊", far: "✈️" };

let S = null;
let placeFilter = "all";
let unveiled = false;
const openNotes = new Set();

/* ---------- dashboard ---------- */

async function load() {
  try {
    const res = await fetch("/api/state");
    S = await res.json();
    render();
  } catch (e) {
    $("#panels").innerHTML = `<div class="notice">Could not read the vault: ${esc(e.message)}</div>`;
  }
}

function allPeople() {
  return (S.kin.exists ? S.kin.rings : []).flatMap((r) => r.people.map((p) => ({ ...p, ringTitle: r.title })));
}

function findPerson(name) {
  const n = String(name).toLowerCase();
  return allPeople().find((p) => p.name.toLowerCase() === n) ?? allPeople().find((p) => p.name.toLowerCase().includes(n));
}

function obsidianLink(name) {
  return `obsidian://open?vault=${encodeURIComponent(S.vaultName)}&file=${encodeURIComponent(name)}`;
}

function render() {
  const y = window.scrollY;
  const { config, kin } = S;

  $("#meta").textContent = [
    `vault ${S.vaultName}`,
    kin.exists && kin.updated ? `kin map updated ${day(kin.updated)}` : null,
  ].filter(Boolean).join(" · ");

  $("#actions").innerHTML = config.actions
    .map((a, i) => `<button data-action="${i}" title="${esc(a.hint ?? a.prompt)}">${esc(a.label)}</button>`)
    .join("");

  const notices = [];
  if (!config.exists) notices.push(`No <code>4 - Archive/kin/Hearth.md</code> in the vault yet, so the hearth runs on defaults. Ask Claude to tend the hearth and it will write one.`);
  if (config.error) notices.push(`Hearth.md: ${esc(config.error)}`);
  if (!kin.exists) notices.push(`No Kin map yet. Run <code>/kin:map</code> to draw the first one.`);
  $("#notices").innerHTML = notices.map((n) => `<div class="notice">${n}</div>`).join("");

  const renderers = { focus: focusPanel, "weak-points": weakPanel, rings: ringsPanel, tending: tendingPanel, inner: innerPanel };
  const html = config.panels.filter((p) => renderers[p]).map((p) => renderers[p]()).join("");
  $("#panels").innerHTML = html || `<p class="muted">No panels configured.</p>`;

  $("#changes").innerHTML = config.changes
    ? `<details class="changes"><summary>How the hearth has changed</summary><div class="html">${config.changes}</div></details>`
    : "";
  window.scrollTo(0, y);
}

function personSub(p) {
  if (!p) return "";
  const bits = [p.ringTitle?.replace(/\(.*\)/, "").trim(), p.placeLabel, p.lastThread ? `last thread ${p.lastThread}` : null];
  const drafts = p.draftsWaiting ? ` <span class="badge">${p.draftsWaiting} draft${p.draftsWaiting > 1 ? "s" : ""} waiting</span>` : "";
  return `<div class="sub">${esc(bits.filter(Boolean).join(" · "))}${drafts}</div>`;
}

function focusPanel() {
  const { pinned, watch } = S.config;
  if (!pinned.length && !watch.length) return "";
  const today = Date.now();
  const card = (item, kind) => {
    const it = typeof item === "string" ? { name: item } : item;
    const until = day(it.until);
    const soon = until && (new Date(until) - today) / 864e5 <= 14;
    return `<div class="focus-card ${soon ? "soon" : ""}">
      <div class="name">${esc(it.name)}${until ? ` <span class="place">· until ${esc(until)}</span>` : ""}</div>
      ${it.why ? `<div class="why">${esc(it.why)}</div>` : ""}
      ${personSub(findPerson(it.name))}
      ${kind === "watch" || kind === "pin" ? personOps(it.name) : ""}
    </div>`;
  };
  return `<section class="panel"><h2>Focus</h2>
    ${pinned.length ? `<div class="label">Pinned</div><div class="focus-grid">${pinned.map((p) => card(p, "pin")).join("")}</div>` : ""}
    ${watch.length ? `<div class="label">Watching</div><div class="focus-grid">${watch.map((w) => card(w, "watch")).join("")}</div>` : ""}
  </section>`;
}

function weakPanel() {
  const w = S.kin.exists && S.kin.weakPoints;
  if (!w) return "";
  return `<section class="panel"><h2>${esc(w.heading)}</h2><div class="html">${w.html}</div></section>`;
}

function personOps(name) {
  const n = esc(name);
  return `<div class="ops">
    <button class="tiny" data-run="/kin:tend focus on ${n}">tend</button>
    <button class="tiny" data-run="/kin:repair ${n}">repair</button>
    <button class="tiny" data-run="/beeper:thread-reply ${n}">reply</button>
  </div>`;
}

function personRow(p) {
  const key = `${p.ring}:${p.name}`;
  const name = p.linked ? `<a href="${obsidianLink(p.name)}">${esc(p.name)}</a>` : esc(p.name);
  return `<div class="person">
    <div class="row">
      <span class="name">${name}</span>
      ${p.place ? `<span class="place" title="${esc(p.placeLabel)}">${PLACE_ICON[p.place]} ${esc(p.placeLabel.replace(/^\S+\s*/, ""))}</span>` : p.placeLabel ? `<span class="place">${esc(p.placeLabel)}</span>` : ""}
      ${p.draftsWaiting ? `<span class="badge" title="drafts not fully sent">${p.draftsWaiting}✎</span>` : ""}
      ${p.lastThread ? `<span class="date">${esc(p.lastThread)}</span>` : ""}
    </div>
    ${p.note ? `<div class="note ${openNotes.has(key) ? "open" : ""}" data-note="${esc(key)}">${esc(p.note.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1"))}</div>` : ""}
    ${personOps(p.name)}
  </div>`;
}

function ringsPanel() {
  if (!S.kin.exists) return "";
  const chips = ["all", "here", "land", "lisbon", "far"]
    .map((k) => `<button class="chip ${placeFilter === k ? "on" : ""}" data-filter="${k}">${k === "all" ? "all" : `${PLACE_ICON[k]} ${k}`}</button>`)
    .join("");
  const rings = S.kin.rings
    .map((r) => {
      const people = r.people.filter((p) => placeFilter === "all" || p.place === placeFilter);
      return `<div class="ring">
        <h3>${esc(r.title)}</h3>
        ${placeFilter === "all" && r.intro ? `<div class="intro html">${r.intro}</div>` : ""}
        ${people.map(personRow).join("") || `<p class="muted" style="font-size:13px">No one here${placeFilter === "all" ? "" : " in this place"}.</p>`}
        ${placeFilter === "all" && r.extra ? `<div class="intro html">${r.extra}</div>` : ""}
      </div>`;
    })
    .join("");
  const other = S.kin.other
    .map((o) => `<section class="panel"><h2>${esc(o.heading)}</h2><div class="html">${o.html}</div></section>`)
    .join("");
  return `<section class="panel"><h2>Rings <span class="filters">${chips}</span></h2><div class="rings">${rings}</div></section>${other}`;
}

function tendingPanel() {
  const t = S.tending;
  const body = t && t.latest.length
    ? t.latest.map((b) => `<h3>${esc(b.heading)}</h3><div class="html">${b.html}</div>`).join("")
    : `<p class="muted">No tending log yet. Run <em>Tend this week</em>.</p>`;
  return `<section class="panel"><h2>Tending</h2>${body}</section>`;
}

function innerPanel() {
  const { psychology, territory } = S.inner;
  if (!psychology && !territory) return "";
  const col = (title, note) =>
    note ? `<div><div class="label">${esc(title)}${note.updated ? ` · ${esc(day(note.updated))}` : ""}</div>
      ${note.sections.map((s) => `<h3>${esc(s.heading)}</h3><div class="html">${s.html}</div>`).join("")}</div>` : "";
  const veiled = S.config.innerVeiled && !unveiled;
  return `<section class="panel"><h2>Inner work ${S.config.innerVeiled && unveiled ? `<button class="tiny ghost" data-veil>veil again</button>` : ""}</h2>
    <div class="veil ${veiled ? "veiled" : ""}">
      <div class="veil-body inner-cols">${col("Own psychology", psychology)}${col("Own territory", territory)}</div>
      <div class="veil-cover"><button data-unveil>Tap to unveil</button></div>
    </div></section>`;
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action],[data-run],[data-filter],[data-note],[data-unveil],[data-veil]");
  if (!t) return;
  if (t.dataset.action != null) startNew(S.config.actions[+t.dataset.action].prompt);
  else if (t.dataset.run != null) startNew(t.dataset.run);
  else if (t.dataset.filter) { placeFilter = t.dataset.filter; render(); }
  else if (t.dataset.note) {
    openNotes.has(t.dataset.note) ? openNotes.delete(t.dataset.note) : openNotes.add(t.dataset.note);
    t.classList.toggle("open");
  } else if (t.hasAttribute("data-unveil")) { unveiled = true; render(); }
  else if (t.hasAttribute("data-veil")) { unveiled = false; render(); }
});

function listen() {
  const es = new EventSource("/api/events");
  let timer;
  es.onmessage = (m) => {
    try {
      if (JSON.parse(m.data).type === "vault") { clearTimeout(timer); timer = setTimeout(load, 300); }
    } catch {}
  };
}

/* ---------- chat ---------- */

let sessionId = null;
let running = false;
let bubble = null;
let bubbleText = "";

function scrollLog() { const l = $("#log"); l.scrollTop = l.scrollHeight; }

function append(cls, html) {
  $(".hint", $("#log"))?.remove();
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  $("#log").appendChild(el);
  scrollLog();
  return el;
}

function light(text) {
  // Escape first, then a little markdown: bold, italics, bullets, paragraphs.
  const blocks = esc(text).split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l)))
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s/, ""))}</li>`).join("")}</ul>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}
const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");

function setRunning(on, status = "") {
  running = on;
  $("#stop").hidden = !on;
  $("#send").disabled = on;
  $("#chatStatus").textContent = status || (on ? "thinking…" : sessionId ? "listening" : "");
}

function startNew(prompt) {
  if (running) { append("msg error", "A turn is still running. Stop it first."); return; }
  sessionId = null;
  $("#log").innerHTML = "";
  openChat();
  send(prompt);
}

async function send(message) {
  if (!message.trim() || running) return;
  append("msg user", esc(message));
  bubble = null; bubbleText = "";
  setRunning(true);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sessionId ? { message, sessionId } : { message }),
    });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (data) { try { handle(JSON.parse(data)); } catch (e) { console.warn(e, data); } }
      }
    }
  } catch (e) {
    append("msg error", esc(e.message));
  } finally {
    setRunning(false);
  }
}

function handle(ev) {
  switch (ev.type) {
    case "session": sessionId = ev.sessionId; break;
    case "status": $("#chatStatus").textContent = ev.text; break;
    case "text":
      if (!bubble) bubble = append("msg assistant", "");
      bubbleText += ev.delta;
      bubble.innerHTML = light(bubbleText);
      scrollLog();
      break;
    case "tool":
      bubble = null; bubbleText = "";
      append("tool", `↳ ${esc(ev.name)}${ev.summary ? ` · ${esc(ev.summary)}` : ""}`);
      break;
    case "permission": {
      bubble = null; bubbleText = "";
      const el = append("perm", `<strong>Claude wants to use ${esc(ev.tool)}</strong><pre>${esc(ev.summary)}</pre>
        <div class="chat-buttons"><button class="ghost" data-deny>Deny</button><button class="primary" data-allow>Allow</button></div>`);
      const decide = async (allow) => {
        $(".chat-buttons", el).outerHTML = `<div class="done">${allow ? "Allowed" : "Denied"}</div>`;
        await fetch("/api/permission", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ev.id, allow }) });
      };
      $("[data-allow]", el).onclick = () => decide(true);
      $("[data-deny]", el).onclick = () => decide(false);
      $("#chatStatus").textContent = "waiting for you";
      break;
    }
    case "done":
      if (ev.isError) append("msg error", esc(ev.result || "The turn ended with an error."));
      append("cost", ev.costUsd != null ? `$${Number(ev.costUsd).toFixed(3)}` : "done");
      break;
    case "error": append("msg error", esc(ev.message)); break;
  }
}

$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#input").value;
  $("#input").value = "";
  send(v);
});
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#form").requestSubmit(); }
});
$("#stop").onclick = () => fetch("/api/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
$("#newChat").onclick = () => {
  if (running) return;
  sessionId = null;
  $("#log").innerHTML = `<p class="muted hint">New conversation.</p>`;
  setRunning(false);
};
function openChat() { $("#chat").classList.add("open"); }
$("#openChat").onclick = openChat;
$("#closeChat").onclick = () => $("#chat").classList.remove("open");

load();
listen();
