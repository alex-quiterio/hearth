// Hearth frontend: a garden around a hearth fire. Renders /api/state, streams /api/chat. No build step.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const day = (d) => (d ? String(d).slice(0, 10) : "");
const PLACE = { here: "here", land: "near the land", lisbon: "Lisbon", far: "far" };
const RING_ORDER = ["core", "close", "warm", "new", "drifting"];
const RING_NAME = { core: "Core", close: "Close", warm: "Warm", new: "New", drifting: "Drifting" };
const FROM = { thread: "a thread you wrote", tending: "the tending log", water: "marked tended here", map: "the kin map" };

// Logged out (password changed, or the year is up): every call answers 401, so go back to the login page.
const rawFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await rawFetch(...args);
  if (res.status === 401) location.href = "/login";
  return res;
};

let S = null;
let G = null; // garden, from the server or derived
let placeFilter = "all";
let unveiled = false;
const watered = new Set(); // optimistic waterings until the vault catches up

/* ---------- data ---------- */

let retry = null;
let stopped = false; // stopped on purpose from the page: no relighting
let events = null;
async function load() {
  clearTimeout(retry);
  if (stopped) return;
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    S = await res.json();
    G = S.garden ?? deriveGarden(S);
    $("#logout").hidden = !S.auth;
    for (const n of watered) applyWater(n);
    render();
  } catch (e) {
    // Never stay stuck: say so and keep trying (the server may be restarting).
    console.warn("state failed", e);
    if (!S) {
      if (!$("#garden .ember-game")) {
        $("#garden").innerHTML = `<p class="muted relight">The fire went out, relighting… Keep this ember going while you wait.</p><div class="ember-slot"></div>`;
        window.emberGame?.($("#garden .ember-slot"));
      }
    } else toast("The fire went out, relighting…");
    retry = setTimeout(load, 2000);
  }
}

// Older servers have no garden: build plants from the kin rings, thirst unknown.
function deriveGarden(s) {
  const today = new Date().toISOString().slice(0, 10);
  const plants = (s.kin.exists ? s.kin.rings : []).flatMap((r) =>
    r.people.map((p) => ({ ...p, ring: r.key, lastTended: p.lastThread ?? null, lastTendedFrom: p.lastThread ? "thread" : null,
      daysSince: p.lastThread ? Math.round((Date.parse(today) - Date.parse(p.lastThread)) / 864e5) : null,
      interval: 14, thirst: "unknown", thisWeek: false, pinned: null, watch: null })),
  );
  return { today, week: null, thisWeek: [], plants, rhythm: [] };
}

const plantOf = (name) => G.plants.find((p) => p.name === name) ?? G.plants.find((p) => p.name.toLowerCase().includes(String(name).toLowerCase()));
const firstName = (n) => String(n).replace(/^the\s+/i, "").split(/\s+/)[0];
const obsidianLink = (name) => `obsidian://open?vault=${encodeURIComponent(S.vaultName)}&file=${encodeURIComponent(name)}`;
const daysUntil = (d) => (d ? Math.round((Date.parse(day(d)) - Date.parse(G.today)) / 864e5) : null);
function sinceText(p) {
  const d = p.daysSince;
  if (d == null) return "no record of contact yet";
  if (d === 0) return "in touch today";
  if (d === 1) return "in touch yesterday";
  if (d < 7) return `in touch ${d} days ago`;
  return `${d} days since you were in touch`;
}

function applyWater(name) {
  const p = plantOf(name);
  if (p) Object.assign(p, { thirst: "fresh", daysSince: 0, lastTended: G.today, lastTendedFrom: "water" });
  const w = G.thisWeek.find((t) => t.name === name);
  if (w && !w.done) Object.assign(w, { done: true, outcome: w.outcome || "tended today" });
}

async function water(name, el) {
  watered.add(name);
  applyWater(name);
  el?.classList.add("rippling");
  setTimeout(render, el ? 650 : 0);
  try {
    const r = await (await fetch("/api/water", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })).json();
    if (!r.ok) throw new Error(r.error || "the vault did not take it");
  } catch (e) {
    watered.delete(name);
    toast(`Could not mark ${name} as tended: ${e.message}`);
    load();
  }
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

/* ---------- render ---------- */

function render() {
  const y = window.scrollY;
  const { config, kin } = S;
  const d = new Date(G.today + "T12:00");
  $("#today").textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const active = G.rhythm.filter((r) => r.active).length;
  $("#rhythm").innerHTML = G.rhythm.length
    ? `<span class="dots">${G.rhythm.map((r) => `<i class="${r.active ? "on" : ""}" title="${esc(r.date)}${r.active ? " · in touch" : ""}"></i>`).join("")}</span>
       <span class="muted">${active ? `in touch on ${active} of the last 7 days` : "a quiet week so far"}</span>`
    : "";

  $("#actions").innerHTML = config.actions
    .map((a, i) => `<button class="tool ${/hearth/i.test(a.label) ? "gardener" : ""}" data-action="${i}" title="${esc(a.hint ?? a.prompt)}">${esc(a.label)}</button>`)
    .join("");

  const notices = [];
  if (!config.exists) notices.push(`No <code>4 - Archive/kin/Hearth.md</code> yet, so the hearth runs on defaults.`);
  if (config.error) notices.push(`Hearth.md: ${esc(config.error)}`);
  if (!kin.exists) notices.push(`No Kin map yet. Run <code>/kin:map</code> to draw the first one.`);
  $("#notices").innerHTML = notices.map((n) => `<div class="notice">${n}</div>`).join("");

  $("#garden").innerHTML = gardenSvg();
  $("#legend").innerHTML = legend();

  const byPanel = { focus: frostSection, "weak-points": weatherSection, rings: bedsSection, inner: soilSection };
  const rest = config.panels.filter((p) => byPanel[p]).map((p) => byPanel[p]());
  $("#sections").innerHTML = [wateringSection(), askingSection(), ...rest, journalSection()].join("");
  window.scrollTo(0, y);
}

/* ---------- the garden svg ---------- */

const BEDS = { core: [70, 140], close: [140, 220], warm: [220, 290], new: [290, 350], drifting: [350, 398] };
const SIZE = { core: 1.35, close: 1.05, warm: 0.9, new: 0.75, drifting: 0.8 };

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

function gardenSvg() {
  const C = 400;
  let beds = "";
  RING_ORDER.forEach((k, i) => {
    const [a, b] = BEDS[k];
    beds += `<circle class="bed bed-${k}" cx="${C}" cy="${C}" r="${(a + b) / 2}" stroke-width="${b - a - 4}"/>`;
    beds += `<text class="bed-label" x="${C}" y="${C - (a + b) / 2 + 4}" text-anchor="middle">${RING_NAME[k]}</text>`;
  });
  // fallen leaves drift in the outer bed
  let fallen = "";
  for (let i = 0; i < 18; i++) {
    const t = (i / 18) * Math.PI * 2 + 0.3, r = 360 + hash("leaf" + i) * 30;
    fallen += `<path class="fallen" d="M0 0 C 4 -3, 8 -3, 11 0 C 8 3, 4 3, 0 0Z" transform="translate(${C + r * Math.cos(t)} ${C + r * Math.sin(t)}) rotate(${hash("r" + i) * 360})"/>`;
  }
  let plants = "";
  for (const k of RING_ORDER) {
    const list = G.plants.filter((p) => p.ring === k);
    const [a, b] = BEDS[k];
    const gap = 0.42; // keep the top of each bed free for its label
    const span = Math.PI * 2 - gap;
    list.forEach((p, i) => {
      const step = span / Math.max(list.length, 1);
      const t = -Math.PI / 2 + gap / 2 + step * (i + 0.5) + (hash(p.name) - 0.5) * step * 0.35;
      const r = (a + b) / 2 + 8 + (hash(p.name + "r") - 0.5) * (b - a) * 0.25;
      plants += plantSvg(p, C + r * Math.cos(t), C + r * Math.sin(t));
    });
  }
  return `<svg viewBox="0 0 800 800" role="group" aria-label="Kin map: the rings around the hearth">
    <defs><radialGradient id="glow"><stop offset="0" stop-color="var(--amber)" stop-opacity=".45"/><stop offset="1" stop-color="var(--amber)" stop-opacity="0"/></radialGradient></defs>
    ${beds}${fallen}
    <circle cx="400" cy="400" r="78" fill="url(#glow)" class="glow"/>
    ${fire()}
    ${plants}
  </svg>`;
}

function fire() {
  return `<g class="fire" transform="translate(400 414)" aria-hidden="true">
    <rect x="-26" y="2" width="52" height="9" rx="4.5" class="log" transform="rotate(12)"/>
    <rect x="-26" y="2" width="52" height="9" rx="4.5" class="log" transform="rotate(-12)"/>
    <path class="flame f1" d="M0 4 C -18 -4, -16 -26, -2 -44 C -2 -30, 10 -28, 8 -14 C 14 -20, 16 -10, 16 -4 C 14 2, 8 4, 0 4Z"/>
    <path class="flame f2" d="M0 4 C -10 0, -10 -16, 0 -28 C 2 -18, 9 -14, 8 -4 C 6 2, 3 4, 0 4Z"/>
    <path class="flame f3" d="M0 4 C -5 2, -5 -6, 0 -14 C 2 -8, 5 -5, 4 0 C 3 3, 1 4, 0 4Z"/>
  </g>`;
}

const LEAF = "M0 0 C 5 -4, 11 -4, 15 0 C 11 4, 5 4, 0 0Z";

function plantSvg(p, x, y) {
  const s = SIZE[p.ring] ?? 1;
  const th = p.thirst || "unknown";
  const droop = th === "wilting" ? 1 : th === "thirsty" ? 0.45 : 0;
  let body = "";
  if (th === "unknown") {
    body = `<ellipse class="seed" cx="0" cy="-3" rx="5" ry="3.6"/><path class="stem" d="M0 -5 C 0 -9, 1 -11, 0 -13"/><path class="leaf" d="${LEAF}" transform="translate(0 -12) rotate(-60) scale(.5)"/>`;
  } else if (p.ring === "new") {
    body = `<path class="stem" d="M0 0 C 0 -6, 0 -10, 0 -15"/>
      <path class="leaf" d="${LEAF}" transform="translate(0 -14) rotate(${-150 + droop * 60}) scale(.8)"/>
      <path class="leaf" d="${LEAF}" transform="translate(0 -14) rotate(${-30 - droop * 60}) scale(.8)"/>`;
  } else if (p.ring === "core") {
    // a small tree: trunk and a round crown that thins with thirst
    const n = th === "wilting" ? 2 : th === "thirsty" ? 3 : 4;
    const blobs = [[0, -34, 13], [-11, -27, 10], [11, -27, 10], [0, -22, 9]].slice(0, n);
    body = `<path class="trunk" d="M-2 0 L-1.5 -22 L1.5 -22 L2 0Z"/>${blobs.map(([cx, cy, r]) => `<circle class="leaf" cx="${cx}" cy="${cy + droop * 4}" r="${r}"/>`).join("")}`;
  } else {
    const bend = droop * 10;
    const top = `${bend} -28`;
    body = `<path class="stem" d="M0 0 C 0 -10, ${bend * 0.3} -20, ${top}"/>`;
    const leaves = th === "wilting" ? [[-9, 1], [-17, -1]] : [[-9, 1], [-15, -1], [-21, 1], [-25, -1]].slice(0, th === "thirsty" ? 3 : 4);
    for (const [ly, side] of leaves) {
      const ang = side > 0 ? -25 + droop * 70 : -155 - droop * 70;
      body += `<path class="leaf" d="${LEAF}" transform="translate(${(bend * -ly) / 28} ${ly}) rotate(${ang})"/>`;
    }
    if (p.ring === "warm" && th !== "wilting") body += `<circle class="bloom" cx="${bend}" cy="-30" r="4.5"/><circle class="bloom-heart" cx="${bend}" cy="-30" r="1.8"/>`;
    if (th === "wilting") body += `<path class="leaf fallen-own" d="${LEAF}" transform="translate(6 2) rotate(10) scale(.8)"/>`;
  }

  const until = p.watch ? daysUntil(p.watch.until) : null;
  const marks = [
    p.place ? `<rect class="place place-${p.place}" x="-10" y="3" width="20" height="3" rx="1.5"/>` : "",
    p.pinned != null ? `<ellipse class="stone" cx="-13" cy="1" rx="5" ry="3.5"/>` : "",
    p.watch ? `<g class="flag ${until != null && until <= 7 ? "near" : ""}" transform="translate(12 0)"><path d="M0 0 V-16"/><path class="ribbon" d="M0 -16 L8 -13 L0 -10Z"/></g>` : "",
    p.thisWeek ? drop(p) : "",
  ].join("");

  const label = `${p.name}, ${RING_NAME[p.ring]}, ${sinceText(p)}${p.thisWeek ? ", in this week's tending" : ""}`;
  return `<g class="plant t-${th} ring-${p.ring}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" tabindex="0" role="button" data-plant="${esc(p.name)}" aria-label="${esc(label)}">
    <circle class="hit" r="${24 * s}" cy="${-12 * s}"/>
    <ellipse class="soil" cx="0" cy="2" rx="${11 * s}" ry="${3 * s}"/>
    <g class="sway" style="animation-delay:${(-hash(p.name) * 6).toFixed(2)}s"><g transform="scale(${s})">${body}</g></g>
    ${marks}
    <circle class="ripple" r="6" cy="-6"/>
    <text class="plabel" y="${18}" text-anchor="middle">${esc(firstName(p.name))}</text>
  </g>`;
}

function drop(p) {
  const done = G.thisWeek.find((t) => t.name === p.name)?.done;
  return `<path class="drop ${done ? "done" : ""}" d="M0 -6 C 3 -2, 4 1, 0 4 C -4 1, -3 -2, 0 -6Z" transform="translate(-14 -24) scale(1.2)"/>`;
}

function legend() {
  const sw = (cls, label) => `<span class="lg"><svg viewBox="-12 -24 24 30" width="18" height="22" aria-hidden="true"><g class="plant t-${cls} ring-close"><g transform="scale(.75)">${
    cls === "unknown" ? `<ellipse class="seed" cx="0" cy="-3" rx="5" ry="3.6"/>` :
    `<path class="stem" d="M0 0 C 0 -10, 0 -20, ${cls === "wilting" ? 10 : cls === "thirsty" ? 4 : 0} -28"/><path class="leaf" d="${LEAF}" transform="translate(0 -15) rotate(${cls === "wilting" ? 40 : cls === "thirsty" ? 10 : -25})"/><path class="leaf" d="${LEAF}" transform="translate(0 -9) rotate(${cls === "wilting" ? 140 : cls === "thirsty" ? 170 : -155})"/>`
  }</g></g></svg>${label}</span>`;
  const places = Object.entries(PLACE).map(([k, v]) => `<span class="lg"><i class="pm place-${k}"></i>${v}</span>`).join("");
  return `<div class="lg-row"><span class="lg-title">Since contact</span>${sw("fresh", "in touch recently")}${sw("ok", "due")}${sw("thirsty", "overdue")}${sw("wilting", "long overdue")}${sw("unknown", "no record")}</div>
    <div class="lg-row"><span class="lg-title">Marks</span>
      <span class="lg"><svg viewBox="-6 -7 12 12" width="12" height="12" aria-hidden="true"><path class="drop" d="M0 -6 C 3 -2, 4 1, 0 4 C -4 1, -3 -2, 0 -6Z"/></svg>this week's tending</span>
      <span class="lg"><svg viewBox="-6 -5 12 10" width="12" height="10" aria-hidden="true"><ellipse class="stone" rx="5" ry="3.5"/></svg>pinned</span>
      <span class="lg"><svg viewBox="-2 -18 12 20" width="10" height="16" aria-hidden="true"><g class="flag"><path d="M0 0 V-16"/><path class="ribbon" d="M0 -16 L8 -13 L0 -10Z"/></g></svg>watching</span>
    </div>
    <div class="lg-row"><span class="lg-title">Place</span>${places}</div>`;
}

/* ---------- sections ---------- */

const kindChip = (k) => `<span class="kind kind-${esc(String(k).toLowerCase())}">${esc(k)}</span>`;

function wateringSection() {
  const items = G.thisWeek;
  if (!items.length)
    return `<section class="panel watering"><h2>This week's tending</h2>
      <p class="muted">No tending planned this week.</p><button class="tool" data-run="/kin:tend">Tend this week</button></section>`;
  const card = (t) => `<article class="wcard ${t.done ? "done" : ""}" data-wcard="${esc(t.name)}">
      <div class="whead">${kindChip(t.kind)}<button class="linkish name" data-sheet="${esc(t.name)}">${esc(t.name)}</button>${t.done ? `<span class="settled">✓ tended</span>` : ""}</div>
      ${t.gesture ? `<p class="gesture">${esc(t.gesture)}</p>` : ""}
      ${t.done && t.outcome ? `<p class="outcome">${esc(t.outcome)}</p>` : ""}
      <div class="ops">
        ${t.done ? "" : `<button class="water" data-water="${esc(t.name)}">Tended</button>`}
        <button class="tiny" data-run="/beeper:thread-reply ${esc(t.name)} — gesture: ${esc(t.gesture)}">Write</button>
      </div>
      <span class="wave" aria-hidden="true"></span>
    </article>`;
  return `<section class="panel watering"><h2>This week's tending ${G.week ? `<span class="sub">${esc(G.week.heading)}</span>` : ""}</h2>
    ${G.week?.intro ? `<div class="html intro">${G.week.intro}</div>` : ""}
    ${wgroup("Still to tend", items.filter((t) => !t.done), card, "Everyone is tended this week.")}
    ${wgroup("Tended", items.filter((t) => t.done), card)}</section>`;
}

/** One group of this week's cards, with its count. Empty groups disappear unless they have something to say. */
function wgroup(title, list, card, empty = "") {
  if (!list.length) return empty ? `<h3 class="wgroup">${title}</h3><p class="muted">${empty}</p>` : "";
  return `<h3 class="wgroup">${title} <span class="count">${list.length}</span></h3>
    <div class="wgrid">${list.map(card).join("")}</div>`;
}

function askingSection() {
  const asking = G.plants
    .filter((p) => ["thirsty", "wilting"].includes(p.thirst) && ["core", "close", "new"].includes(p.ring) && !p.thisWeek)
    .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0))
    .slice(0, 5);
  if (!asking.length) return "";
  return `<section class="panel"><h2>Gone quiet</h2><div class="asks">${asking
    .map((p) => `<div class="ask" data-wcard="${esc(p.name)}"><button class="linkish name" data-sheet="${esc(p.name)}">${esc(p.name)}</button>
      <span class="muted">${esc(sinceText(p))}</span>
      <span class="ops"><button class="water tiny" data-water="${esc(p.name)}">Tended</button><button class="tiny" data-run="/kin:tend focus on ${esc(p.name)}">Tend</button></span>
      <span class="wave" aria-hidden="true"></span></div>`)
    .join("")}</div></section>`;
}

function frostSection() {
  const { pinned, watch } = S.config;
  if (!pinned.length && !watch.length) return "";
  const ws = [...watch].sort((a, b) => (day(a.until) || "9999").localeCompare(day(b.until) || "9999"));
  const row = (w) => {
    const n = daysUntil(w.until);
    const when = n == null ? "" : n < 0 ? "passed" : n === 0 ? "today" : `in ${n} day${n === 1 ? "" : "s"}`;
    return `<li class="${n != null && n <= 7 ? "near" : ""}"><button class="linkish name" data-sheet="${esc(w.name)}">${esc(w.name)}</button>
      ${w.until ? `<span class="when">${esc(day(w.until))} · ${when}</span>` : ""}<div class="why">${esc(w.why ?? "")}</div></li>`;
  };
  const anchors = pinned.map((p) => (typeof p === "string" ? { name: p } : p));
  return `<section class="panel"><h2>Focus</h2>
    ${anchors.length ? `<div class="label">Pinned</div><ul class="frost anchors">${anchors.map((a) => `<li><button class="linkish name" data-sheet="${esc(a.name)}">${esc(a.name)}</button><div class="why">${esc(a.why ?? "")}</div></li>`).join("")}</ul>` : ""}
    ${ws.length ? `<div class="label">Watching</div><ul class="frost">${ws.map(row).join("")}</ul>` : ""}
  </section>`;
}

function weatherSection() {
  const w = S.kin.exists && S.kin.weakPoints;
  const other = S.kin.exists ? S.kin.other : [];
  if (!w && !other.length) return "";
  return `${w ? `<section class="panel weather"><h2>${esc(w.heading)}</h2><div class="html">${w.html}</div></section>` : ""}
    ${other.length ? `<div class="minis">${other.map((o) => `<section class="panel mini"><h3>${esc(o.heading)}</h3><div class="html">${o.html}</div></section>`).join("")}</div>` : ""}`;
}

function bedsSection() {
  if (!S.kin.exists) return "";
  const chips = ["all", "here", "land", "lisbon", "far"]
    .map((k) => `<button class="chip ${placeFilter === k ? "on" : ""}" data-filter="${k}">${k === "all" ? "all" : PLACE[k]}</button>`)
    .join("");
  const beds = S.kin.rings.map((r) => {
    const people = r.people.filter((p) => placeFilter === "all" || p.place === placeFilter);
    const rows = people.map((p0) => {
      const p = plantOf(p0.name) ?? p0;
      return `<li><button class="linkish row" data-sheet="${esc(p.name)}"><i class="tdot t-${esc(p.thirst ?? "unknown")}"></i><span class="name">${esc(p.name)}</span>
        ${p.place ? `<span class="pm place-${p.place}" title="${esc(p.placeLabel)}"></span>` : ""}
        ${p.draftsWaiting ? `<span class="badge">${p.draftsWaiting}✎</span>` : ""}
        <span class="since muted">${p.daysSince != null ? `${p.daysSince}d` : ""}</span></button></li>`;
    }).join("");
    return `<details class="bedlist" ${["core", "close"].includes(r.key) ? "open" : ""}><summary>${esc(r.title)} <span class="muted">${people.length}</span></summary>
      ${placeFilter === "all" && r.intro ? `<div class="intro html">${r.intro}</div>` : ""}
      <ul>${rows || `<li class="muted">No one here${placeFilter === "all" ? "" : " in this place"}.</li>`}</ul></details>`;
  }).join("");
  return `<section class="panel beds"><h2>Rings <span class="filters">${chips}</span></h2><div class="bedgrid">${beds}</div></section>`;
}

function soilSection() {
  const { psychology, territory } = S.inner;
  if (!psychology && !territory) return "";
  const col = (title, note) =>
    note ? `<div><div class="label">${esc(title)}${note.updated ? ` · ${esc(day(note.updated))}` : ""}</div>
      ${note.sections.map((s) => `<h3>${esc(s.heading)}</h3><div class="html">${s.html}</div>`).join("")}</div>` : "";
  const veiled = S.config.innerVeiled && !unveiled;
  return `<section class="panel soil"><h2>Inner work ${S.config.innerVeiled && unveiled ? `<button class="tiny ghost" data-veil>veil again</button>` : ""}</h2>
    <div class="veil ${veiled ? "veiled" : ""}">
      <div class="veil-body inner-cols">${col("Own psychology", psychology)}${col("Own territory", territory)}</div>
      <div class="veil-cover"><button data-unveil>Tap to unveil</button></div>
    </div></section>`;
}

function journalSection() {
  const t = S.tending;
  const log = t && t.latest.length ? t.latest.map((b) => `<h3>${esc(b.heading)}</h3><div class="html">${b.html}</div>`).join("") : `<p class="muted">No tending log yet.</p>`;
  return `<details class="panel journal"><summary><h2>Tending log</h2></summary>
    ${log}
    ${S.config.changes ? `<div class="label">How the hearth has changed</div><div class="html">${S.config.changes}</div>` : ""}
  </details>`;
}

/* ---------- person sheet ---------- */

function openSheet(name) {
  const p = plantOf(name);
  const w = G.thisWeek.find((t) => t.name === name);
  const n = esc(name);
  if (!p) { toast(`${name} is not in the kin map.`); return; }
  $("#sheet").innerHTML = `<form method="dialog" class="sheet-close"><button class="ghost" aria-label="Close">✕</button></form>
    <h2>${p.linked ? `<a href="${obsidianLink(p.name)}">${n}</a>` : n}</h2>
    <p class="muted">${esc(RING_NAME[p.ring])}${p.placeLabel ? ` · ${esc(p.placeLabel)}` : ""}</p>
    <p class="since-line t-${esc(p.thirst)}"><i class="tdot t-${esc(p.thirst)}"></i>${esc(sinceText(p))}${p.lastTendedFrom ? ` <span class="muted">· from ${esc(FROM[p.lastTendedFrom] ?? p.lastTendedFrom)}</span>` : ""}</p>
    ${p.note ? `<p class="note">${esc(p.note.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1"))}</p>` : ""}
    ${p.draftsWaiting ? `<p><span class="badge">${p.draftsWaiting} draft${p.draftsWaiting > 1 ? "s" : ""} not fully sent</span></p>` : ""}
    ${w ? `<div class="sheet-box">${kindChip(w.kind)} <strong>This week</strong><p>${esc(w.gesture)}</p>${w.done ? `<p class="outcome">✓ ${esc(w.outcome || "tended")}</p>` : ""}</div>` : ""}
    ${p.pinned ? `<div class="sheet-box"><strong>Pinned</strong><p>${esc(p.pinned)}</p></div>` : ""}
    ${p.watch ? `<div class="sheet-box"><strong>Watching${p.watch.until ? ` until ${esc(day(p.watch.until))}` : ""}</strong><p>${esc(p.watch.why ?? "")}</p></div>` : ""}
    <div class="ops sheet-ops">
      <button class="water" data-water="${n}">Tended</button>
      <button class="tiny" data-run="/beeper:thread-reply ${n}${w?.gesture ? ` — gesture: ${esc(w.gesture)}` : ""}">Write</button>
      <button class="tiny" data-run="/kin:tend focus on ${n}">Tend</button>
      <button class="tiny" data-run="/kin:repair ${n}">Repair</button>
      ${p.linked ? `<a class="tiny btnlike" href="${obsidianLink(p.name)}">Open in Obsidian</a>` : ""}
    </div>`;
  $("#sheet").showModal();
}

/* ---------- tooltip ---------- */

function showTip(g) {
  const p = plantOf(g.dataset.plant);
  if (!p) return;
  const tip = $("#tip");
  tip.innerHTML = `<strong>${esc(p.name)}</strong><span>${esc(sinceText(p))}</span>${p.note ? `<span class="muted">${esc(p.note.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").slice(0, 110))}${p.note.length > 110 ? "…" : ""}</span>` : ""}`;
  tip.hidden = false;
  const wrap = $(".garden-wrap").getBoundingClientRect();
  const r = g.getBoundingClientRect();
  const x = Math.min(Math.max(r.left + r.width / 2 - wrap.left, 110), wrap.width - 110);
  tip.style.left = `${x}px`;
  tip.style.top = `${r.top - wrap.top - 8}px`;
}
const hideTip = () => ($("#tip").hidden = true);

$("#garden").addEventListener("mouseover", (e) => { const g = e.target.closest(".plant"); g ? showTip(g) : hideTip(); });
$("#garden").addEventListener("mouseleave", hideTip);
$("#garden").addEventListener("focusin", (e) => { const g = e.target.closest(".plant"); if (g) showTip(g); });
$("#garden").addEventListener("focusout", hideTip);
$("#garden").addEventListener("keydown", (e) => {
  const g = e.target.closest(".plant");
  if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSheet(g.dataset.plant); }
});

/* ---------- clicks ---------- */

document.addEventListener("click", (e) => {
  const plant = e.target.closest(".plant[data-plant]");
  if (plant && plant.closest("#garden")) { hideTip(); openSheet(plant.dataset.plant); return; }
  const t = e.target.closest("[data-action],[data-run],[data-filter],[data-unveil],[data-veil],[data-sheet],[data-water]");
  if (!t) return;
  if (t.dataset.water != null) {
    const name = t.dataset.water;
    const card = t.closest("[data-wcard]") ?? document.querySelector(`#garden .plant[data-plant="${CSS.escape(name)}"]`);
    if ($("#sheet").open) $("#sheet").close();
    const inGarden = document.querySelector(`#garden .plant[data-plant="${CSS.escape(name)}"]`);
    inGarden?.classList.add("rippling");
    water(name, card);
  } else if (t.dataset.action != null) startNew(S.config.actions[+t.dataset.action].prompt);
  else if (t.dataset.run != null) { if ($("#sheet").open) $("#sheet").close(); startNew(t.dataset.run); }
  else if (t.dataset.sheet != null) openSheet(t.dataset.sheet);
  else if (t.dataset.filter) { placeFilter = t.dataset.filter; render(); }
  else if (t.hasAttribute("data-unveil")) { unveiled = true; render(); }
  else if (t.hasAttribute("data-veil")) { unveiled = false; render(); }
});
$("#sheet").addEventListener("click", (e) => { if (e.target === $("#sheet")) $("#sheet").close(); });

function listen() {
  const es = (events = new EventSource("/api/events"));
  let timer;
  let opened = false;
  // After a server restart the stream reconnects: reload in case we missed changes.
  es.onopen = () => { if (opened) load(); opened = true; };
  es.onmessage = (m) => {
    try {
      if (JSON.parse(m.data).type === "vault") { clearTimeout(timer); timer = setTimeout(() => { watered.clear(); load(); }, 300); }
    } catch {}
  };
}

/* ---------- chat drawer: collapse to a rail ---------- */

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
function setCollapsed(on) {
  document.body.classList.toggle("chat-collapsed", on);
  store.set("hearth.chatCollapsed", on ? "1" : "0");
}
setCollapsed(store.get("hearth.chatCollapsed") === "1");
$("#collapseChat").onclick = () => setCollapsed(true);
$("#rail").onclick = () => setCollapsed(false);
document.addEventListener("keydown", (e) => {
  if (e.key !== "\\" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input,textarea,select,[contenteditable]") || $("#sheet").open) return;
  e.preventDefault();
  setCollapsed(!document.body.classList.contains("chat-collapsed"));
});
let waitingPermissions = 0;
function updateRailDot() {
  const dot = $("#railDot");
  dot.hidden = !(running || waitingPermissions);
  dot.classList.toggle("ask", waitingPermissions > 0);
  $("#rail").title = waitingPermissions ? "Claude is waiting for your approval" : running ? "Claude is working" : "Open the conversation (\\)";
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
  if (work) $("#log").appendChild(work);
  if (queueEl) $("#log").appendChild(queueEl);
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

/* The working row: always the last thing in the log while a turn runs, so it is never
   ambiguous whether Claude is still going. Ember, what it is doing, and for how long. */
let work = null, workText = "Thinking", workStart = 0, workTimer = null;
const BASE_TITLE = document.title;

function renderWork() {
  if (!work) return;
  const secs = Math.floor((Date.now() - workStart) / 1000);
  const t = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
  const asking = waitingPermissions > 0;
  work.classList.toggle("asking", asking);
  $(".work-text", work).textContent = asking ? "Waiting for your approval" : `${workText}…`;
  $(".work-time", work).textContent = t;
  const status = asking ? "waiting for you" : `${workText.toLowerCase()} · ${t}`;
  $("#chatStatus").textContent = status;
  document.title = `${asking ? "◆ Approve" : "● " + workText} · ${BASE_TITLE}`;
  const fab = $("#openChat");
  if (fab) fab.textContent = asking ? "Approve in Conversation" : `Claude is ${workText.toLowerCase()}…`;
}
function showWork() {
  if (!work) {
    work = document.createElement("div");
    work.className = "working";
    work.setAttribute("role", "status");
    work.setAttribute("aria-live", "polite");
    work.innerHTML = `<span class="ember" aria-hidden="true"><i></i><i></i><i></i></span><span class="work-text"></span><span class="work-time muted"></span>`;
  }
  $("#log").appendChild(work); // move to the bottom
  if (queueEl) $("#log").appendChild(queueEl);
  renderWork();
  scrollLog();
}
function setActivity(text) { workText = text; renderWork(); }

function setRunning(on, status = "") {
  running = on;
  $("#stop").hidden = !on;
  $("#send").textContent = on ? "Queue" : "Send";
  document.body.classList.toggle("claude-working", on);
  clearInterval(workTimer);
  if (on) {
    workStart = Date.now(); workText = "Thinking";
    showWork();
    workTimer = setInterval(renderWork, 1000);
  } else {
    work?.remove(); work = null;
    document.title = BASE_TITLE;
    const fab = $("#openChat"); if (fab) fab.textContent = "Conversation";
    $("#chatStatus").textContent = status || (sessionId ? "listening" : "");
  }
  updateRailDot();
  syncProposal();
}

/* Messages written while Claude works wait here and go out together when the turn ends.
   After Stop they return to the input instead, so nothing is sent he did not mean to. */
let queue = [];
let queueEl = null;
let stopAsked = false;

function renderQueue() {
  if (!queue.length) { queueEl?.remove(); queueEl = null; return; }
  if (!queueEl) { queueEl = document.createElement("div"); queueEl.className = "queue"; }
  queueEl.innerHTML = queue.map((m, i) => `<div class="msg user queued"><span class="queued-text">${esc(m)}</span>
    <div class="queued-meta">Queued · <button type="button" class="linkish" data-unqueue="${i}">remove</button></div></div>`).join("");
  queueEl.querySelectorAll("[data-unqueue]").forEach((b) => (b.onclick = () => { queue.splice(+b.dataset.unqueue, 1); renderQueue(); }));
  $("#log").appendChild(queueEl);
  scrollLog();
}

function flushQueue() {
  if (!queue.length) return;
  const text = queue.join("\n\n");
  queue = []; renderQueue();
  if (stopAsked) {
    const box = $("#input");
    box.value = box.value.trim() ? `${text}\n\n${box.value}` : text;
    box.focus();
  } else send(text);
}

/* Attachments: the browser hides real paths, so files go to the server and Claude reads the copy.
   A note dragged from Obsidian arrives as an obsidian:// link and is read in place in the vault. */
let attachments = []; // { id, name, path?, ready: Promise, error? }

function renderAttachments() {
  const box = $("#attachments");
  box.hidden = !attachments.length;
  box.innerHTML = attachments.map((a) => `<span class="chip ${a.path ? "" : a.error ? "failed" : "loading"}" title="${esc(a.error || a.path || "Uploading…")}">
    ${esc(a.name)}<button type="button" class="linkish" data-unattach="${a.id}" aria-label="Remove ${esc(a.name)}">×</button></span>`).join("");
  box.querySelectorAll("[data-unattach]").forEach((b) => (b.onclick = () => {
    attachments = attachments.filter((a) => a.id !== b.dataset.unattach);
    renderAttachments();
  }));
}

function attach(form, names) {
  const items = names.map((name) => ({ id: crypto.randomUUID(), name }));
  const ready = fetch("/api/attach", { method: "POST", body: form })
    .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; })
    .then((saved) => items.forEach((it, i) => Object.assign(it, saved[i])))
    .catch((e) => items.forEach((it) => (it.error = e.message)))
    .finally(renderAttachments);
  items.forEach((it) => (it.ready = ready));
  attachments.push(...items);
  renderAttachments();
}

function attachFiles(files) {
  if (!files.length) return;
  const form = new FormData();
  for (const f of files) form.append("file", f, f.name || "pasted.png");
  attach(form, [...files].map((f) => f.name || "pasted image"));
}

function attachObsidian(uris) {
  const form = new FormData();
  uris.forEach((u) => form.append("obsidian", u));
  attach(form, uris.map((u) => new URL(u).searchParams.get("file")?.split("/").pop() || "note"));
}

/** The message as Claude gets it: the text, then one line per attached path. Clears the chips. */
async function withAttachments(text) {
  const list = attachments;
  attachments = []; renderAttachments();
  await Promise.all(list.map((a) => a.ready));
  const ok = list.filter((a) => a.path);
  list.filter((a) => a.error).forEach((a) => append("msg error", esc(`${a.name}: ${a.error}`)));
  if (!ok.length) return text;
  return `${text.trim() || "Have a look at this."}\n\nAttached:\n${ok.map((a) => `- ${a.path}`).join("\n")}`;
}

$("#attach").onclick = () => $("#file").click();
$("#file").onchange = (e) => { attachFiles(e.target.files); e.target.value = ""; };
$("#input").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) { e.preventDefault(); attachFiles(files); }
});
{
  const chat = $("#chat");
  let depth = 0;
  chat.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; chat.classList.add("dropping"); });
  chat.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; chat.classList.remove("dropping"); } });
  chat.addEventListener("dragover", (e) => e.preventDefault());
  chat.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0; chat.classList.remove("dropping");
    const dt = e.dataTransfer;
    const links = `${dt.getData("text/uri-list")}\n${dt.getData("text/plain")}`.split(/\s+/).filter((l) => l.startsWith("obsidian://"));
    if (links.length) attachObsidian([...new Set(links)]);
    else attachFiles(dt.files);
    openChat();
  });
}

/* Buttons never send on their own: they propose a prompt, and Alex confirms where it goes.
   One wrong click must not replace the conversation he is in. */
let proposal = null;
const hasThread = () => !!sessionId || !!$(".msg", $("#log"));

function startNew(prompt) {
  openChat();
  if (!$("#history").hidden) showHistory(false);
  proposal?.remove();
  const thread = hasThread();
  proposal = append("proposal", `
    <div class="proposal-head"><strong>Send this to Claude?</strong>
      <span class="muted">${thread ? "You are in a conversation." : "Edit it first if you like."}</span></div>
    <textarea rows="2" aria-label="Prompt to send"></textarea>
    <div class="chat-buttons">
      <button type="button" class="ghost" data-cancel>Cancel</button>
      ${thread ? `<button type="button" class="ghost" data-here>Send in this conversation</button>` : ""}
      <button type="button" class="primary" data-new>${thread ? "Start new conversation" : "Send"}</button>
    </div>
    <p class="muted proposal-note" hidden>Claude is still working. You can send when the turn ends.</p>`);
  const card = proposal;
  const box = $("textarea", card);
  box.value = prompt;
  box.style.height = Math.min(160, box.scrollHeight + 4) + "px";
  const go = (fresh) => {
    const text = box.value.trim();
    if (!text || running) return;
    card.remove(); proposal = null;
    if (fresh) { sessionId = null; $("#log").innerHTML = ""; }
    send(text);
  };
  const cancel = () => { card.remove(); proposal = null; };
  $("[data-new]", card).onclick = () => go(true);
  $("[data-here]", card)?.addEventListener("click", () => go(false));
  $("[data-cancel]", card).onclick = cancel;
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(true); }
  });
  syncProposal();
  box.focus();
}

/** While a turn runs, a waiting proposal can be read and edited but not sent. */
function syncProposal() {
  if (!proposal) return;
  proposal.querySelectorAll("[data-new],[data-here]").forEach((b) => (b.disabled = running));
  $(".proposal-note", proposal).hidden = !running;
}

async function send(message) {
  if (!message.trim()) return;
  if (running) { queue.push(message.trim()); renderQueue(); return; }
  stopAsked = false;
  append("msg user", esc(message));
  bubble = null; bubbleText = "";
  setRunning(true);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, ...(sessionId && { sessionId }), ...($("#model").value && { model: $("#model").value }) }),
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
    waitingPermissions = 0;
    setRunning(false);
    flushQueue();
  }
}

function handle(ev) {
  switch (ev.type) {
    case "session": sessionId = ev.sessionId; break;
    case "status": if (ev.text === "stopped") setActivity("Stopping"); break;
    case "activity": setActivity(ev.text); break;
    case "text":
      if (!bubble) bubble = append("msg assistant", "");
      bubbleText += ev.delta;
      bubble.innerHTML = light(bubbleText);
      if (work) $("#log").appendChild(work);
      scrollLog();
      break;
    case "tool":
      bubble = null; bubbleText = "";
      append("tool", `↳ ${esc(ev.name)}${ev.summary ? ` · ${esc(ev.summary)}` : ""}`);
      break;
    case "permission": {
      bubble = null; bubbleText = "";
      waitingPermissions++;
      updateRailDot();
      const el = append("perm", `<strong>Claude wants to use ${esc(ev.tool)}</strong><pre>${esc(ev.summary)}</pre>
        <div class="chat-buttons"><button class="ghost" data-deny>Deny</button><button class="primary" data-allow>Allow</button></div>`);
      const decide = async (allow) => {
        $(".chat-buttons", el).outerHTML = `<div class="done">${allow ? "Allowed" : "Denied"}</div>`;
        waitingPermissions = Math.max(0, waitingPermissions - 1);
        updateRailDot();
        renderWork();
        await fetch("/api/permission", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ev.id, allow }) });
      };
      $("[data-allow]", el).onclick = () => decide(true);
      $("[data-deny]", el).onclick = () => decide(false);
      renderWork();
      break;
    }
    case "done":
      if (ev.isError) append("msg error", esc(ev.result || "The turn ended with an error."));
      append("stamp", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      break;
    case "error": append("msg error", esc(ev.message)); break;
  }
}

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("#input").value;
  if (!v.trim() && !attachments.length) return;
  $("#input").value = "";
  send(await withAttachments(v));
});
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#form").requestSubmit(); }
});
// The model picker: Claude Code's own list, remembered per browser, applied from the next turn on.
(async () => {
  const pick = $("#model");
  pick.onchange = () => store.set("hearth.model", pick.value);
  try {
    const res = await fetch("/api/models");
    if (!res.ok) throw new Error(await res.text());
    const list = await res.json();
    // Aliases (opus, sonnet…) track the newest models; pinned ids like claude-opus-4-7 go under "Older".
    const opt = (m) => `<option value="${esc(m.value)}" title="${esc(m.description ?? "")}">${esc(m.displayName.replace(/\s*\(recommended\)/i, ""))}</option>`;
    const older = list.filter((m) => m.value.startsWith("claude-"));
    pick.innerHTML = list.filter((m) => !older.includes(m)).map(opt).join("") +
      (older.length ? `<optgroup label="Older">${older.map(opt).join("")}</optgroup>` : "");
  } catch (e) {
    console.warn("models", e);
  }
  // Opus until a choice is saved.
  const saved = store.get("hearth.model") ?? "opus";
  if ([...pick.options].some((o) => o.value === saved)) pick.value = saved;
})();

$("#stop").onclick = () => (stopAsked = true, fetch("/api/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
$("#newChat").onclick = () => {
  if (running) return;
  if ($(".msg", $("#log")) && !confirm("Start a new conversation? This one stays in Claude Code's history but leaves this panel.")) return;
  proposal = null;
  sessionId = null;
  $("#log").innerHTML = `<p class="muted hint">New conversation.</p>`;
  setRunning(false);
};
function openChat() { $("#chat").classList.add("open"); setCollapsed(false); }
$("#openChat").onclick = openChat;
$("#closeChat").onclick = () => $("#chat").classList.remove("open");

load();
listen();

/* Stop the server from the page. The launcher (Hearth.app) starts it again. */
$("#logout").onclick = () => $("#logoutForm").submit();

$("#shutdown").onclick = async () => {
  if (!confirm("Stop the Hearth server? Open Hearth.app to start it again.")) return;
  try { await fetch("/api/shutdown", { method: "POST" }); } catch {}
  stopped = true;
  clearTimeout(retry);
  events?.close();
  document.body.innerHTML = `<main class="stopped"><h1>Hearth is resting</h1>
    <p class="muted">The server is stopped. Open <strong>Hearth.app</strong> on your Desktop to light it again.</p>
    <p class="muted">Meanwhile, one small ember is still going:</p><div class="ember-slot"></div></main>`;
  window.emberGame?.($(".stopped .ember-slot"));
  document.title = "Hearth (stopped)";
};

/* ---------- history: previous conversations, read back from Claude Code's sessions ---------- */

const when = (ms) => {
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }) + ` ${time}`;
};

function showHistory(on) {
  $("#history").hidden = !on;
  $("#log").hidden = on;
  $("#historyBtn").setAttribute("aria-expanded", String(on));
  $("#historyBtn").textContent = on ? "Back" : "History";
  if (on) loadHistory();
}

async function loadHistory() {
  const box = $("#history");
  box.innerHTML = `<p class="muted hist-empty">Reading past conversations…</p>`;
  let list = [];
  try { list = await (await fetch("/api/sessions")).json(); } catch {}
  if (!list.length) { box.innerHTML = `<p class="muted hist-empty">No previous conversations yet.</p>`; return; }
  box.innerHTML = list.map((x) => `
    <div class="hist-row${x.id === sessionId ? " current" : ""}" data-id="${esc(x.id)}">
      <button class="hist-open" data-id="${esc(x.id)}">
        <span class="hist-title">${esc(x.title)}</span>
        <span class="hist-meta muted">${esc(when(x.lastModified))}${x.firstPrompt && x.firstPrompt !== x.title ? ` · ${esc(x.firstPrompt.slice(0, 80))}` : ""}${x.id === sessionId ? " · open now" : ""}</span>
      </button>
      <button class="hist-del ghost" data-del="${esc(x.id)}" title="Delete this conversation" aria-label="Delete ${esc(x.title)}">✕</button>
    </div>`).join("");
}

async function openSession(id) {
  if (running) { toast("Claude is still working. Stop the turn first."); return; }
  if (id === sessionId) { showHistory(false); return; }
  if ($(".msg", $("#log")) && !confirm("Open this conversation? The one in the panel stays in History.")) return;
  const lines = await (await fetch(`/api/sessions/${encodeURIComponent(id)}`)).json();
  showHistory(false);
  sessionId = id;
  proposal = null;
  bubble = null; bubbleText = "";
  $("#log").innerHTML = `<p class="muted hint">An earlier conversation. Write below to continue it.</p>`;
  for (const l of lines) {
    if (l.kind === "user") append("msg user", esc(l.text));
    else if (l.kind === "assistant") append("msg assistant", light(l.text));
    else append("tool", `↳ ${esc(l.text)}`);
  }
  $("#chatStatus").textContent = "continuing";
}

$("#historyBtn").onclick = () => showHistory($("#history").hidden);
$("#history").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    if (!confirm("Delete this conversation for good? It is removed from Claude Code too.")) return;
    const id = del.dataset.del;
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (id === sessionId) { sessionId = null; $("#log").innerHTML = `<p class="muted hint">New conversation.</p>`; }
    loadHistory();
    return;
  }
  const open = e.target.closest(".hist-open");
  if (open) openSession(open.dataset.id);
});

/* ---------- resizable conversation panel ---------- */

const CHAT_W = { min: 300, def: 420 };
const maxChatW = () => Math.max(CHAT_W.min, Math.min(1100, window.innerWidth - 480)); // keep the page usable
function setChatWidth(w, save = true) {
  const px = Math.round(Math.min(maxChatW(), Math.max(CHAT_W.min, w)));
  document.documentElement.style.setProperty("--chat-w", px + "px");
  resizer.setAttribute("aria-valuenow", String(px));
  if (save) try { localStorage.setItem("hearth.chatWidth", String(px)); } catch {}
  return px;
}
const resizer = document.createElement("div");
resizer.className = "chat-resize";
Object.assign(resizer, { tabIndex: 0, title: "Drag to resize · double-click to reset" });
resizer.setAttribute("role", "separator");
resizer.setAttribute("aria-orientation", "vertical");
resizer.setAttribute("aria-label", "Resize the conversation panel");
resizer.setAttribute("aria-valuemin", String(CHAT_W.min));
$("#chat").prepend(resizer);

let saved = CHAT_W.def;
try { saved = Number(localStorage.getItem("hearth.chatWidth")) || CHAT_W.def; } catch {}
setChatWidth(saved, false);

resizer.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  const move = (ev) => setChatWidth(window.innerWidth - ev.clientX, false);
  const up = (ev) => {
    resizer.releasePointerCapture(ev.pointerId);
    resizer.removeEventListener("pointermove", move);
    document.body.classList.remove("resizing");
    setChatWidth(window.innerWidth - ev.clientX);
  };
  resizer.addEventListener("pointermove", move);
  resizer.addEventListener("pointerup", up, { once: true });
});
resizer.addEventListener("dblclick", () => setChatWidth(CHAT_W.def));
resizer.addEventListener("keydown", (e) => {
  const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--chat-w")) || CHAT_W.def;
  const step = e.shiftKey ? 80 : 20;
  if (e.key === "ArrowLeft") { e.preventDefault(); setChatWidth(cur + step); }
  else if (e.key === "ArrowRight") { e.preventDefault(); setChatWidth(cur - step); }
  else if (e.key === "Home") { e.preventDefault(); setChatWidth(CHAT_W.def); }
});
// A smaller window must not leave the panel wider than the page allows.
window.addEventListener("resize", () => setChatWidth(parseInt(getComputedStyle(document.documentElement).getPropertyValue("--chat-w")) || CHAT_W.def, false));
