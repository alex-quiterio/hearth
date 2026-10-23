// Hearth frontend: a garden around a hearth fire. Renders /api/state, streams /api/chat. No build step.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const day = (d) => (d ? String(d).slice(0, 10) : "");
const PLACE = { here: "here", land: "near the land", lisbon: "Lisbon", far: "far" };
const RING_ORDER = ["core", "close", "warm", "new", "drifting"];
const RING_NAME = { core: "Core", close: "Close", warm: "Warm", new: "New", drifting: "Drifting" };
const FROM = { thread: "a thread you wrote", tending: "the tending log", water: "marked tended here", map: "the kin map", beeper: "a message on Beeper" };

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
let downSince = null; // when /api/state first failed in a row
async function load() {
  clearTimeout(retry);
  if (stopped) return;
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    S = await res.json();
    G = S.garden ?? deriveGarden(S);
    $("#logout").hidden = $("#autoLock").hidden = !S.auth;
    $("#shutdown").hidden = !S.local;
    showAutoLock();
    for (const n of watered) applyWater(n);
    render();
    downSince = null;
    navigator.serviceWorker?.controller?.postMessage({ servers: S.config.servers ?? [] });
  } catch (e) {
    // Never stay stuck: say so and keep trying (the server may be restarting).
    console.warn("state failed", e);
    // Down for longer than a restart and there is another server: reload, and the service worker moves there.
    downSince ??= Date.now();
    if (Date.now() - downSince > 6000 && (S?.config?.servers ?? []).some((o) => o !== location.origin)) { location.reload(); return; }
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
const spanText = (days) => (days < 1 ? `${Math.max(1, Math.round(days * 24))} hours` : days === 1 ? "1 day" : days % 7 === 0 ? (days === 7 ? "1 week" : `${days / 7} weeks`) : `${Math.round(days)} days`);
function sinceText(p) {
  if (p.waitingSince) {
    const h = Math.floor((Date.now() - p.waitingSince) / 36e5);
    const ago = h < 1 ? "in the last hour" : h < 24 ? `${h} hours ago` : h < 48 ? "yesterday" : `${Math.floor(h / 24)} days ago`;
    return `wrote to you ${ago}, waiting on your reply (within ${spanText(p.replyWithin)})`;
  }
  const d = p.daysSince;
  if (d == null) return "no record of contact yet";
  if (d === 0) return "in touch today";
  if (d === 1) return "in touch yesterday";
  if (d < 7) return `in touch ${d} days ago`;
  return `${d} days since you were in touch`;
}

function applyWater(name) {
  const p = plantOf(name);
  if (p) Object.assign(p, { thirst: "fresh", daysSince: 0, lastTended: G.today, lastTendedFrom: "water", waitingSince: null });
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
    .map((a, i) => (/hearth/i.test(a.prompt) ? `<button class="tool gardener" data-action="${i}" title="${esc(a.hint ?? a.prompt)}">${esc(a.label)}</button>` : ""))
    .join("");
  if ($("#menu").open) renderMenu();

  const notices = [];
  if (!config.exists) notices.push(`No <code>${esc(config.path)}</code> yet, so the hearth runs on defaults.`);
  if (config.error) notices.push(`Hearth.md: ${esc(config.error)}`);
  if (!kin.exists) notices.push(`No Kin map yet. Run <code>/kin:map</code> to draw the first one.`);
  $("#notices").innerHTML = notices.map((n) => `<div class="notice">${n}</div>`).join("");

  $("#garden").innerHTML = gardenSvg();
  $("#legend").innerHTML = legend();

  // Inner work and practice live on the Inner screen; the kin screen keeps the rest, in config order.
  const byPanel = { focus: frostSection, "weak-points": weatherSection, rings: bedsSection };
  const rest = config.panels.filter((p) => byPanel[p]).map((p) => byPanel[p]());
  $("#sections").innerHTML = [wateringSection(), askingSection(), birthdaysSection(), ...rest, journalSection()].join("");
  $("#innerScreen").innerHTML = innerScreen();
  showScreen();
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
    p.nextBirthday && p.nextBirthday.in <= SOON ? candle() : "",
  ].join("");

  const bday = p.nextBirthday && p.nextBirthday.in <= SOON ? `, birthday ${birthdayWhen(p.nextBirthday.in)}` : "";
  const label = `${p.name}, ${RING_NAME[p.ring]}, ${sinceText(p)}${p.thisWeek ? ", in this week's tending" : ""}${bday}`;
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

const CANDLE = `<rect class="candle" x="-1.5" y="-6" width="3" height="7" rx="1"/><path class="candle-flame" d="M0 -11 C 2 -8.5, 2 -7, 0 -6.5 C -2 -7, -2 -8.5, 0 -11Z"/>`;
const candle = () => `<g class="bday" transform="translate(14 -20)">${CANDLE}</g>`;

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
      <span class="lg"><svg viewBox="-4 -12 8 14" width="8" height="14" aria-hidden="true"><g class="bday">${CANDLE}</g></svg>birthday within ${SOON} days</span>
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

const BIRTHDAY_AHEAD = 45; // days of birthdays the Kin screen looks ahead
const SOON = 14; // a birthday this close puts a candle on the plant
const birthdayWhen = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const birthdayDay = (date) => new Date(date + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function birthdaysSection() {
  const ahead = G.plants
    .filter((p) => p.nextBirthday && p.nextBirthday.in <= BIRTHDAY_AHEAD)
    .sort((a, b) => a.nextBirthday.in - b.nextBirthday.in);
  if (!ahead.length) return "";
  return `<section class="panel"><h2>Birthdays ahead <span class="sub">the next ${BIRTHDAY_AHEAD} days</span></h2><ul class="frost">${ahead
    .map((p) => {
      const b = p.nextBirthday;
      return `<li class="${b.in <= 7 ? "near" : ""}"><button class="linkish name" data-sheet="${esc(p.name)}">🎂 ${esc(p.name)}</button>
        <span class="when">${esc(birthdayDay(b.date))} · ${birthdayWhen(b.in)}</span>
        <span class="ops"><button class="tiny" data-run="/beeper:thread-reply ${esc(p.name)} — their birthday is ${esc(b.date)}${b.in ? ` (${birthdayWhen(b.in)})` : " (today)"}">Write</button></span>
        <div class="why muted">${esc(RING_NAME[p.ring])} · ${esc(sinceText(p))}</div></li>`;
    })
    .join("")}</ul></section>`;
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

// The emergent-practice modes, shown under that skill in the main menu.
const PRACTICE_MODES = [
  ["🔮", "cast", "cast a spell"], ["✍️", "write a spell", "write a spell"], ["🌬️", "sit", "sit"], ["🫀", "feel", "feel"],
  ["🤝", "woes", "woes check-in"], ["🌍", "the future", "write the future"], ["🌀", "circle", "circle"], ["🧺", "inventory", "inventory"],
];
const SKILL_MODES = { "/thinking:emergent-practice": PRACTICE_MODES };

function thinkingSection() {
  const t = S.thinking;
  if (!t) return "";
  const today = new Date().toISOString().slice(0, 10);
  const woes = (t.woes ?? []).map((w) => `<button class="chip" title="${esc(w.rhythm || "woe")}" data-run="/thinking:emergent-practice woes check-in with ${esc(w.name)}">${esc(w.name)}${w.rhythm ? ` <span class="muted">${esc(w.rhythm)}</span>` : ""}</button>`).join("");
  const spells = t.spells.map((n) => `<button class="chip" data-run="/thinking:emergent-practice cast my spell &quot;${esc(n)}&quot;">${esc(n)}</button>`).join("");
  const exp = t.experiments.map((e) => {
    const due = e.listenOn && e.listenOn <= today;
    return `<li><a href="${obsidianLink(e.name)}">${esc(e.name.replace(/^Emergent /, ""))}</a>
      ${e.listenOn ? `<span class="${due ? "badge" : "muted"}">listen ${due ? "now" : `on ${esc(e.listenOn)}`}</span>` : ""}
      ${due ? `<button class="tiny" data-run="/thinking:emergent listen back on ${esc(e.name)}">Listen back</button>` : ""}</li>`;
  }).join("");
  const start = `<button class="tiny" data-run="/thinking:emergent-practice">A practice for today</button>`;
  if (!t.exists && !woes) return `<section class="panel thinking"><h2>Practice ${start}</h2>
    <p class="muted">Nothing kept yet. The first practice starts the log and the spellbook; every mode is in the menu.</p></section>`;
  return `<section class="panel thinking"><h2>Practice ${start}</h2>
    <div class="inner-cols">
      <div>
        ${t.practices ? `<div class="label">Practices held</div><div class="html">${t.practices}</div>` : ""}
        ${t.recent ? `<div class="label">Lately</div><div class="html">${t.recent}</div>` : ""}
      </div>
      <div>
        ${woes ? `<div class="label">Woes</div><div class="chips">${woes}</div>` : ""}
        ${spells ? `<div class="label">Spellbook</div><div class="chips">${spells}</div>` : ""}
        ${exp ? `<div class="label">Experiments</div><ul>${exp}</ul>` : ""}
      </div>
    </div></section>`;
}

/* ---------- talk: who Alex talks to, live from Beeper ---------- */

// Messages per person are heavy-tailed, so the bell curve is fitted on a log scale:
// each step on the axis is ×10. Refetched every minute while the screen is open.
let talkDays = 90;
let talkTimer = null;
let T = null;
let SH = null; // shifts: warming, cooling, quiet, waiting
let UN = null; // direct chats with unread messages
let unreadOpen = false; // the To be read section stays as Alex left it across the minute's refetch
const DAY_MS = 86_400_000;
const n0 = (n) => n.toLocaleString("en");
const agoMs = (t) => { const d = Math.floor((Date.now() - t) / DAY_MS); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };

async function loadTalk() {
  clearInterval(talkTimer);
  talkTimer = setInterval(() => screen() === "talk" && !document.hidden && fetchTalk(), 60_000);
  if (!T || T.days !== talkDays) $("#talkScreen").innerHTML = `<section class="panel talk"><p class="muted">Counting…</p></section>`;
  await fetchTalk();
}
async function fetchTalk() {
  try {
    const [res, sh, un] = await Promise.all([fetch(`/api/talk?days=${talkDays}`), fetch("/api/shifts").catch(() => null), fetch("/api/unread").catch(() => null)]);
    const t = await res.json();
    if (t.error) throw new Error(t.error);
    T = t;
    const s = sh?.ok ? await sh.json() : null;
    SH = s && !s.error ? s : null;
    const u = un?.ok ? await un.json() : null;
    UN = u && !u.error ? u : null;
  } catch (e) {
    $("#talkScreen").innerHTML = `<section class="panel talk"><h2>Who I talk to</h2><p class="muted">${esc(e.message)}</p></section>`;
    return;
  }
  renderTalk();
}

// Who is shifting: this month against the usual month over the three before. People on the kin
// map open their sheet; "Bring into the hearth" hands the shifts to /kin:hearth, which edits Hearth.md.
const SHIFT = {
  warming: { title: "Warming", hint: "a lot more than usual this month", line: (p) => `${p.recent} this month · usually ${Math.round(p.usual)}` },
  cooling: { title: "Cooling", hint: "well under the usual", line: (p) => `${p.recent} this month · usually ${Math.round(p.usual)}` },
  quiet: { title: "Gone quiet", hint: "had a rhythm, nothing this month", line: (p) => `usually ${Math.round(p.usual)} a month · last ${agoMs(Math.max(p.lastSent, p.lastReceived))}` },
  waiting: { title: "Waiting on you", hint: "they wrote last", line: (p) => `wrote ${agoMs(p.lastReceived)}` },
};
function shiftsPrompt() {
  const who = (key, p) => `${p.name}${p.ring ? ` (${p.ring})` : " (not on the kin map)"}: ${SHIFT[key].line(p)}`;
  const parts = Object.keys(SHIFT).filter((key) => SH[key].length)
    .map((key) => `${SHIFT[key].title}: ${SH[key].slice(0, 12).map((p) => who(key, p)).join("; ")}.`);
  return `/kin:hearth Also weigh what Beeper shows, message counts only (the last 30 days against the usual month over the 90 days before):\n${parts.join("\n")}\nUse it as one more signal for pinned, watch and the Now list. For people not on the kin map who are warming, suggest kin:map rather than adding them.`;
}
function shiftsSection() {
  if (!SH) return "";
  const row = (key, p) => {
    const name = p.ring ? `<button class="name" data-sheet="${esc(p.kin)}">${esc(p.name)}</button>` : `<span>${esc(p.name)}</span>`;
    const reply = key === "waiting" ? `<button class="tiny ghost" data-run="${esc(`/beeper:thread-reply ${p.name}`)}" title="Draft a reply">Reply</button>` : "";
    return `<li>${name}${p.ring ? `<span class="ring-tag">${esc(p.ring)}</span>` : ""}<small>${esc(SHIFT[key].line(p))}</small>${reply}</li>`;
  };
  const col = (key) => {
    const list = SH[key];
    const shown = list.slice(0, 6), more = list.slice(6);
    return `<div class="shift"><h4>${SHIFT[key].title} <span class="count">${list.length}</span></h4><p class="muted">${SHIFT[key].hint}</p>
      ${list.length ? `<ul>${shown.map((p) => row(key, p)).join("")}</ul>` : `<p class="muted">no one</p>`}
      ${more.length ? `<details><summary>${more.length} more</summary><ul>${more.map((p) => row(key, p)).join("")}</ul></details>` : ""}</div>`;
  };
  return `<h3>Who is shifting <span class="sub">this month against the usual month</span></h3>
    <div class="shifts">${Object.keys(SHIFT).map(col).join("")}</div>
    <div class="shift-bar"><button class="tool gardener" data-run="${esc(shiftsPrompt())}" title="Ask /kin:hearth to update pinned, watch and Now from these shifts">Bring into the hearth</button>
    <span class="muted">Kin map people first; tap one to open them.</span></div>`;
}

// Kin waiting on a reply past twice their window: the red end of the reply clock. The garden
// knows each window; the shifts, refetched every minute, drop anyone answered since.
function replyAlert() {
  const answered = (p) => SH?.all?.some((c) => c.kin === p.name && c.lastSent > p.waitingSince);
  const late = (G?.plants ?? [])
    .filter((p) => p.waitingSince && p.replyWithin && !answered(p))
    .map((p) => ({ p, over: (Date.now() - p.waitingSince) / DAY_MS / p.replyWithin }))
    .filter((x) => x.over > 2)
    .sort((a, b) => b.over - a.over);
  if (!late.length) return "";
  const li = ({ p }) => `<li><button class="name" data-sheet="${esc(p.name)}">${esc(p.name)}</button>
    <small>wrote ${esc(agoMs(p.waitingSince))} · reply within ${esc(spanText(p.replyWithin))}</small>
    <button class="tiny ghost" data-run="${esc(`/beeper:thread-reply ${p.name}`)}" title="Draft a reply">Reply</button></li>`;
  return `<div class="reply-alert" role="alert"><strong>⚠ ${late.length === 1 ? "1 person is" : `${late.length} people are`} long past a reply</strong>
    <ul>${late.map(li).join("")}</ul></div>`;
}

// Unread direct chats, folded by default: who wrote, how many, and the newest unread lines.
function unreadSection() {
  if (!UN) return "";
  const C = UN.chats;
  const total = C.reduce((a, c) => a + c.count, 0);
  const when = (t) => {
    const d = new Date(t), today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
  };
  const chat = (c) => {
    const name = c.ring ? `<button class="name" data-sheet="${esc(c.kin)}">${esc(c.name)}</button>` : `<span class="name">${esc(c.name)}</span>`;
    const reacted = c.reactions.length ? `<li class="reacted">reacted ${esc(c.reactions.join(" "))}</li>` : "";
    const lines = c.messages.map((m) => `<li><time>${esc(when(m.at))}</time><span class="${m.type === "TEXT" ? "" : "media"}">${esc(m.text)}</span></li>`).join("");
    return `<li class="unread-chat"><div class="unread-head">${name}${c.ring ? `<span class="ring-tag">${esc(c.ring)}</span>` : ""}
        <small>${c.count} new · ${esc(c.nets.join(", "))} · ${esc(agoMs(c.last))}</small>
        <button class="tiny ghost" data-run="${esc(`/beeper:thread-reply ${c.name}`)}" title="Draft a reply">Reply</button></div>
      ${lines || reacted ? `<ul class="unread-lines">${lines}${reacted}</ul>` : ""}</li>`;
  };
  return `<details class="unread"${unreadOpen ? " open" : ""}><summary>To be read <span class="count">${total}</span>
      <span class="sub">${C.length ? `from ${C.length === 1 ? "1 person" : `${C.length} people`}` : "none, all read"}</span></summary>
    ${C.length ? `<ul class="unread-list">${C.map(chat).join("")}</ul><p class="muted">Unread as Beeper counts it, direct chats only. Kin map people first; tap one to open them.</p>` : ""}</details>`;
}

function renderTalk() {
  const P = T.people, N = P.length;
  const head = `<h2>Who I talk to <span class="sub">direct chats on Beeper · updated ${new Date(T.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></h2>
    ${replyAlert()}
    ${unreadSection()}
    <div class="talk-bar"><div class="talk-days" role="group" aria-label="Time window">${[7, 30, 90, 365].map((d) => `<button class="ghost" data-talk-days="${d}" aria-pressed="${d === talkDays}">${d === 7 ? "Last week" : d === 365 ? "1 year" : `${d} days`}</button>`).join("")}</div>
    <button class="ghost" data-talk-refresh title="Count again from Beeper">↻ Refresh</button></div>`;
  if (!N) { $("#talkScreen").innerHTML = `<section class="panel talk">${head}<p class="muted">No direct messages in this window.</p></section>`; return; }
  const total = P.reduce((a, p) => a + p.total, 0);
  const xs = P.map((p) => Math.log10(p.total));
  const mu = xs.reduce((a, b) => a + b, 0) / N;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / N) || 0.3;
  const z = (p) => (Math.log10(p.total) - mu) / sd;
  const top5 = P.slice(0, 5).reduce((a, p) => a + p.total, 0);
  const tiles = [[N, "people"], [n0(total), "messages"], [P[Math.floor(N / 2)].total, "with the median person"], [`${Math.round((top5 / total) * 100)}%`, "go to the top 5"]]
    .map(([b, s]) => `<div class="talk-tile"><b>${b}</b><span>${s}</span></div>`).join("");

  // The curve: histogram, fitted Gaussian, ±1σ/±2σ bands, then a dot per person below.
  // Drawn at the panel's real width, so text stays 12px on a phone instead of shrinking with the chart.
  const W = Math.round(Math.min(1000, Math.max(300, ($("#talkScreen").clientWidth || 1000) - 42)));
  const narrow = W < 560;
  const L = 12, R = 12, top = 20, base = narrow ? 170 : 220, bw = 0.2, r = narrow ? 4 : 5, step = 2 * r + 1.5;
  const minX = -0.05, maxX = Math.max(xs[0], mu + 2.5 * sd) + 0.15;
  const X = (v) => L + ((v - minX) / (maxX - minX)) * (W - L - R);
  const bins = Array.from({ length: Math.ceil(maxX / bw) }, () => 0);
  xs.forEach((v) => bins[Math.min(bins.length - 1, Math.floor(v / bw))]++);
  const pdf = (v) => (Math.exp(-((v - mu) ** 2) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI))) * N * bw;
  const ymax = Math.max(...bins, pdf(mu)) * 1.1, Y = (c) => base - (c / ymax) * (base - top);
  let g = [2, 1].map((k) => `<rect x="${X(mu - k * sd)}" y="${top}" width="${X(mu + k * sd) - X(mu - k * sd)}" height="${base - top}" class="band"/>`).join("");
  for (let e = 0; e <= maxX; e++) {
    g += `<line x1="${X(e)}" x2="${X(e)}" y1="${top}" y2="${base}" class="grid"/><text x="${X(e)}" y="${base + 18}" text-anchor="middle">${n0(10 ** e)}</text>`;
    for (const m of [2, 5]) if (e + Math.log10(m) < maxX) g += `<line x1="${X(e + Math.log10(m))}" x2="${X(e + Math.log10(m))}" y1="${base}" y2="${base + 5}" class="axis"/>`;
  }
  bins.forEach((c, i) => {
    if (!c) return;
    const x = X(i * bw) + 1, w = X((i + 1) * bw) - X(i * bw) - 2, y = Y(c);
    g += `<path d="M${x},${base}V${y + 4}q0,-4 4,-4h${w - 8}q4,0 4,4V${base}Z" class="bin"/>`;
  });
  let d = "";
  for (let v = minX; v <= maxX; v += 0.02) d += `${d ? "L" : "M"}${X(v).toFixed(1)},${Y(pdf(v)).toFixed(1)}`;
  g += `<path d="${d}" class="curve"/>`;
  g += `<line x1="${X(mu)}" x2="${X(mu)}" y1="${top}" y2="${base}" class="mu"/><text x="${X(mu) + 6}" y="${top + 12}" class="ink">typical ≈ ${Math.round(10 ** mu)}</text>`;
  (narrow ? [1, 2] : [-1, 1, 2]).forEach((k) => { const v = mu + k * sd; if (v > minX && v < maxX) g += `<text x="${X(v)}" y="${top + 28}" text-anchor="middle">${k > 0 ? "+" : ""}${k}σ · ${Math.round(10 ** v)}</text>`; });
  g += `<line x1="${L}" x2="${W - R}" y1="${base}" y2="${base}" class="axis"/><text x="${L}" y="${base + 38}">messages exchanged →</text>`;
  const dots = [];
  [...P].reverse().forEach((p) => {
    const x = X(Math.log10(p.total));
    let k = 0;
    while (dots.some((o) => o.k === k && Math.abs(o.x - x) < step)) k++;
    dots.push({ x, k, p, cy: base + 58 + k * step });
  });
  const H = base + 58 + (Math.max(...dots.map((o) => o.k)) + 1) * step + 16;
  dots.forEach((o) => { g += `<circle cx="${o.x}" cy="${o.cy}" r="${r}" class="${Date.now() - o.p.last < 14 * DAY_MS ? "dot" : "dot quiet"}"/>`; });
  P.slice(0, 5).forEach((p, i) => { const o = dots.find((o) => o.p === p); g += `<text x="${o.x}" y="${o.cy - r - 6 - (i % 2) * 14}" text-anchor="middle" class="ink">${esc(p.name.split(" ")[0])}</text>`; });
  dots.forEach((o) => { g += `<circle cx="${o.x}" cy="${o.cy}" r="${r + 4}" class="hit" data-talk="${P.indexOf(o.p)}"/>`; });
  const far = P.filter((p) => z(p) > 2);

  // Most frequent: sent and received side by side, with how long since the last message.
  const top20 = P.slice(0, 20), bh = 22, gap = 8, LW = narrow ? 110 : 210, BW = W - LW - (narrow ? 100 : 150), bmax = P[0].total, cut = narrow ? 14 : 26;
  const bars = top20.map((p, i) => {
    const y = i * (bh + gap), ws = (p.sent / bmax) * BW, wr = (p.received / bmax) * BW;
    return `<g data-talk="${i}" class="row"><rect x="0" y="${y - 3}" width="${W}" height="${bh + 6}" class="hit"/>
      <text x="${LW - 10}" y="${y + 15}" text-anchor="end" class="ink">${esc(p.name.length > cut ? p.name.slice(0, cut - 1) + "…" : p.name)}</text>
      ${ws > 0 ? `<rect x="${LW}" y="${y}" width="${Math.max(ws - 1, 1)}" height="${bh}" rx="2" class="sent"/>` : ""}
      ${wr > 0 ? `<rect x="${LW + ws + (ws > 0 ? 1 : 0)}" y="${y}" width="${Math.max(wr - 1, 1)}" height="${bh}" rx="2" class="received"/>` : ""}
      <text x="${LW + ws + wr + 6}" y="${y + 15}">${n0(p.total)}${narrow ? "" : ` · ${agoMs(p.last)}`}</text></g>`;
  }).join("");
  const rows = P.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.nets.join(", "))}</td><td class="n">${p.sent}</td><td class="n">${p.received}</td><td class="n">${p.total}</td><td class="n">${z(p).toFixed(1)}</td><td>${agoMs(p.last)}</td></tr>`).join("");

  $("#talkScreen").innerHTML = `<section class="panel talk">${head}
    <div class="talk-tiles">${tiles}</div>
    ${shiftsSection()}
    <h3>The bell curve</h3>
    <p class="muted">One dot per person, placed by messages exchanged in the last ${talkDays === 7 ? "week" : talkDays === 365 ? "year" : `${talkDays} days`}. Log scale, so each step is ×10; the curve is the fitted Gaussian, the bands ±1σ and ±2σ.</p>
    <div class="talk-legend"><span><i class="dot"></i>in the last 14 days</span><span><i class="dot quiet"></i>quiet for 14+ days</span></div>
    <svg class="talk-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Distribution of messages per person">${g}</svg>
    ${far.length ? `<p class="muted">Past +2σ, further out than the curve expects: ${far.map((p) => esc(p.name)).join(", ")}.</p>` : ""}
    <h3>Most frequent</h3>
    <div class="talk-legend"><span><i class="sent"></i>sent by me</span><span><i class="received"></i>received</span></div>
    <svg class="talk-svg" viewBox="0 0 ${W} ${top20.length * (bh + gap)}" width="${W}" height="${top20.length * (bh + gap)}" role="img" aria-label="Top 20 people by messages">${bars}</svg>
    <details><summary>Everyone, as a table</summary><table class="talk-table"><tr><th>#</th><th>Person</th><th>Where</th><th class="n">Sent</th><th class="n">Received</th><th class="n">Total</th><th class="n">σ</th><th>Last</th></tr>${rows}</table></details>
  </section>`;
}

$("#talkScreen").addEventListener("click", (e) => {
  const d = e.target.closest("[data-talk-days]");
  if (d) { talkDays = Number(d.dataset.talkDays); loadTalk(); }
  if (e.target.closest("[data-talk-refresh]")) fetchTalk();
  // The toggle lands after this click, so read the state on the next tick.
  if (e.target.closest("details.unread > summary")) setTimeout(() => { unreadOpen = !!$("#talkScreen details.unread")?.open; });
});
// The card for a dot or a bar, under the pointer or finger, kept inside the screen.
function showTalkTip(e) {
  const h = e.target.closest("[data-talk]"), tip = talkTip();
  if (!h || !T) { tip.hidden = true; return; }
  const p = T.people[Number(h.dataset.talk)];
  tip.innerHTML = `<strong>${esc(p.name)}</strong><br>${n0(p.total)} messages (${p.sent} sent · ${p.received} received)<br>last ${agoMs(p.last)} · ${esc(p.nets.join(", "))}`;
  tip.hidden = false;
  tip.style.left = `${Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8))}px`;
  tip.style.top = `${e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 14 : e.clientY + 14}px`;
}
$("#talkScreen").addEventListener("mousemove", showTalkTip);
$("#talkScreen").addEventListener("mouseleave", () => { talkTip().hidden = true; });
// Phones have no hover: a tap on a dot or a bar shows the same card, a tap elsewhere hides it.
$("#talkScreen").addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") showTalkTip(e); });
let talkResize;
window.addEventListener("resize", () => { clearTimeout(talkResize); talkResize = setTimeout(() => screen() === "talk" && T && renderTalk(), 200); });
// Its own tooltip: the kin one lives inside the hidden kin screen.
function talkTip() {
  let t = $("#talkTip");
  if (!t) { t = Object.assign(document.createElement("div"), { id: "talkTip", className: "tip talk-tip", hidden: true }); document.body.append(t); }
  return t;
}

/* ---------- servers: which Hearth this is, and the others to connect to ---------- */

const serverName = (o) => { const h = new URL(o).hostname; return /^(127\.|localhost$)/.test(h) ? "this Mac" : h.split(".")[0]; };
$("#serverHere").textContent = serverName(location.origin);
// A no-cors fetch of an open file resolves when the server is up, whatever it answers.
const serverUp = (o) => Promise.race([
  fetch(`${o}/favicon.svg?ping=${Date.now()}`, { mode: "no-cors", cache: "no-store" }).then(() => true, () => false),
  new Promise((r) => setTimeout(() => r(false), 5000)),
]);
function openServers() {
  const list = S?.config?.servers ?? [];
  const all = list.includes(location.origin) ? list : [location.origin, ...list];
  $("#serverList").innerHTML = all.map((o, i) => {
    const here = o === location.origin;
    return `<li class="${here ? "here" : ""}"><i class="${here ? "up" : ""}" data-server="${i}"></i>
      <span class="who"><strong>${esc(serverName(o))}</strong><small>${esc(new URL(o).host)}${list.includes(o) ? "" : " · not in Hearth.md"}</small></span>
      ${here ? `<span class="state">connected</span>` : `<span class="state" data-server-state="${i}">checking…</span><a class="connect" href="${esc(o + location.pathname + location.hash)}" title="Connect to ${esc(serverName(o))}" aria-label="Connect to ${esc(serverName(o))}">🔌</a>`}</li>`;
  }).join("") || `<li>No servers listed yet: add <code>servers:</code> to Hearth.md.</li>`;
  $("#servers").showModal();
  all.forEach(async (o, i) => {
    if (o === location.origin) return;
    const up = await serverUp(o);
    $(`[data-server="${i}"]`)?.setAttribute("class", up ? "up" : "down");
    const st = $(`[data-server-state="${i}"]`);
    if (st) st.textContent = up ? "up" : "not answering";
  });
}
$("#serversOpen").addEventListener("click", openServers);
$("#servers").addEventListener("click", (e) => { if (e.target === $("#servers")) $("#servers").close(); });

/* ---------- screens ---------- */

// Inner is the first screen; the kin garden is #kin; who Alex talks to is #talk.
// Talk needs Beeper on this machine; without it the tab goes away and #talk falls back to Inner.
const screen = () => (location.hash === "#kin" ? "kin" : location.hash === "#talk" && S?.beeper ? "talk" : "inner");
function showScreen() {
  const s = screen();
  $('[data-screen="talk"]').hidden = !S?.beeper;
  $("#kinScreen").hidden = s !== "kin";
  $("#innerScreen").hidden = s !== "inner";
  $("#talkScreen").hidden = s !== "talk";
  if (s === "talk") loadTalk(); else clearInterval(talkTimer);
  document.body.dataset.screen = s;
  document.querySelectorAll("[data-screen]").forEach((a) => a.setAttribute("aria-current", a.dataset.screen === s ? "page" : "false"));
}
window.addEventListener("hashchange", () => { showScreen(); window.scrollTo(0, 0); });

// The skills this screen launches, from the menu when it has loaded, else a fixed few.
const INNER_FALLBACK = [
  ["/inner-work:jung-therapist", "Jung session"], ["/inner-work:proprioception", "Proprioception"],
  ["/inner-work:journal-therapist", "Journal patterns"], ["/thinking:emergent-practice", "A practice for today"],
  ["/thinking:emergent", "Unstick a plan"], ["/thinking:atomic-notes", "Atomic notes"],
  ["/readings:tarot", "Tarot"],
];
// Skills from other plugins that belong on this screen too.
const INNER_EXTRA = ["/readings:tarot"];
function innerLaunch() {
  const groups = MENU.filter((g) => g.plugin === "inner-work" || g.plugin === "thinking");
  const extra = MENU.flatMap((g) => g.items.filter((it) => INNER_EXTRA.includes(it.command)).map((it) => [it.command, it.name, it.hint, g.icon]));
  const items = groups.length
    ? [...groups.flatMap((g) => g.items.map((it) => [it.command, it.name, it.hint, g.icon])), ...extra]
    : INNER_FALLBACK.map(([c, n]) => [c, n, "", ""]);
  return `<section class="panel inner-launch"><h2>Begin</h2><div class="menu">${items.map(([c, n, h, icon]) =>
    `<button class="menu-item" data-run="${esc(c)}" title="${esc(c)}"><span class="menu-icon" aria-hidden="true">${icon}</span><span><span class="menu-name">${esc(n)}</span>${h ? `<span class="menu-hint">${esc(h)}</span>` : ""}</span></button>`).join("")}</div></section>`;
}

function proprioceptionSection() {
  const p = S.innerScreen?.proprioception;
  if (!p) return "";
  const moments = p.moments.map((m) => `<h3>${esc(m.title || "a moment")} <span class="sub">${esc(m.date)}</span></h3><div class="html">${m.html}</div>`).join("");
  return `<section class="panel"><h2>Proprioception <span class="sub">${p.count} moment${p.count === 1 ? "" : "s"}</span>
      <button class="tiny" data-run="/inner-work:proprioception">A moment</button></h2>
    ${moments || `<p class="muted">No moments logged yet.</p>`}
    ${p.weekly ? `<div class="label">Weekly</div><div class="html">${p.weekly}</div>` : ""}</section>`;
}

function coordinationSection() {
  const c = S.innerScreen?.coordination;
  if (!c) return "";
  return `<section class="panel"><h2>Coordination partner <button class="tiny" data-run="/thinking:coordination-partner">Check in</button></h2>
    ${c.sections.slice(0, 2).map((x) => `<h3>${esc(x.heading)}</h3><div class="html">${x.html}</div>`).join("")}</section>`;
}

function notesSection() {
  const n = S.innerScreen?.notes ?? [];
  if (!n.length) return "";
  return `<section class="panel"><h2>Lately thought</h2><ul class="notes">${n.map((x) =>
    `<li><a href="${obsidianLink(x.name)}">${esc(x.name)}</a> <span class="muted">${esc(new Date(x.mtime).toISOString().slice(0, 10))}</span></li>`).join("")}</ul></section>`;
}

/* ---------- the inner sky ---------- */

// Moon age in days since a known new moon (2000-01-06 18:14 UTC), synodic month 29.53 days.
const SYNODIC = 29.530588;
function moonAge(date) {
  const age = ((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % SYNODIC;
  return age < 0 ? age + SYNODIC : age;
}
function moonName(age) {
  const names = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon", "waning gibbous", "last quarter", "waning crescent", "new moon"];
  return names[Math.min(8, Math.floor((age / SYNODIC) * 8 + 0.5))];
}
function moonSvg(cx, cy, r, age) {
  const k = Math.cos((2 * Math.PI * age) / SYNODIC); // 1 new, -1 full
  const rx = (r * Math.abs(k)).toFixed(2);
  const waxing = age < SYNODIC / 2;
  const lit = (1 - k) / 2;
  const [s1, s2] = waxing ? [1, k > 0 ? 0 : 1] : [0, k > 0 ? 1 : 0];
  const d = `M${cx} ${cy - r} A${r} ${r} 0 0 ${s1} ${cx} ${cy + r} A${rx} ${r} 0 0 ${s2} ${cx} ${cy - r}Z`;
  return `<g class="moon"><circle class="moon-dark" cx="${cx}" cy="${cy}" r="${r}"/>${lit > 0.02 ? `<path class="moon-lit" d="${d}"/>` : ""}</g>`;
}

function skySvg() {
  const today = G.today;
  const lit = new Set([...(S.thinking?.days ?? []), ...(S.innerScreen?.proprioception?.days ?? [])]);
  const days = Array.from({ length: 28 }, (_, i) => new Date(Date.parse(today) - (27 - i) * 864e5).toISOString().slice(0, 10));
  const [cx, cy, rx, ry] = [400, 236, 318, 168];
  const stars = days.map((d, i) => {
    const a = Math.PI + (i / 27) * Math.PI * 1.9 - 0.15; // from the left, over the top, round to today
    const x = (cx + rx * Math.cos(a)).toFixed(1), y = (cy + ry * Math.sin(a)).toFixed(1);
    const on = lit.has(d), now = d === today;
    const size = now ? 9 : on ? 7 : 2.6;
    const star = on || now
      ? `<path class="star ${on ? "on" : ""}" style="animation-delay:${(i % 7) * 0.6}s" d="M0 ${-size} Q1.4 -1.4 ${size} 0 Q1.4 1.4 0 ${size} Q-1.4 1.4 ${-size} 0 Q-1.4 -1.4 0 ${-size}Z"/>`
      : `<circle class="star-off" r="${size}"/>`;
    return `<g transform="translate(${x} ${y})"><title>${esc(d)}${on ? " · practised" : ""}${now ? " · today" : ""}</title>${now ? `<circle class="today-ring" r="14"/>` : ""}${star}</g>`;
  }).join("");
  const spells = (S.thinking?.spells ?? []).slice(0, 7);
  const seeds = spells.map((n, i) => {
    const x = 400 + (i - (spells.length - 1) / 2) * 70 + (i % 2 ? 14 : -14);
    return `<g class="seed-drift" style="animation-duration:${16 + (i % 3) * 3}s;animation-delay:${-i * 4.3}s" transform="translate(${x.toFixed(0)} 360)"><title>${esc(n)}</title>
      <line class="seed-stem" x1="0" y1="0" x2="0" y2="-14"/>${Array.from({ length: 9 }, (_, j) => { const a = -Math.PI / 2 + (j - 4) * 0.33; return `<line class="seed-hair" x1="0" y1="-14" x2="${(Math.cos(a) * 9).toFixed(1)}" y2="${(-14 + Math.sin(a) * 9).toFixed(1)}"/>`; }).join("")}
      <circle class="seed-head" cy="1" r="1.8"/></g>`;
  }).join("");
  const age = moonAge(new Date(today + "T21:00"));
  return `<svg viewBox="0 0 800 440" role="img" aria-label="Inner sky: a breathing candle, the last 28 days of practice as stars, tonight's moon">
    <defs><radialGradient id="candleGlow"><stop offset="0" stop-color="var(--amber)" stop-opacity=".45"/><stop offset="1" stop-color="var(--amber)" stop-opacity="0"/></radialGradient></defs>
    ${moonSvg(704, 62, 24, age)}
    ${stars}
    <circle class="glow" cx="400" cy="270" r="120" fill="url(#candleGlow)"/>
    <g class="breath" transform="translate(400 262)"><circle class="halo" r="46"/><circle class="halo halo-2" r="46"/></g>
    ${seeds}
    <g class="candle" transform="translate(400 300)" aria-hidden="true">
      <ellipse class="stone" cx="0" cy="34" rx="34" ry="7"/>
      <rect class="wax" x="-11" y="-6" width="22" height="40" rx="3"/>
      <line class="wick" x1="0" y1="-6" x2="0" y2="-11"/>
      <g transform="translate(0 -9) scale(.7)">
        <path class="flame f1" d="M0 4 C -18 -4, -16 -26, -2 -44 C -2 -30, 10 -28, 8 -14 C 14 -20, 16 -10, 16 -4 C 14 2, 8 4, 0 4Z"/>
        <path class="flame f2" d="M0 4 C -10 0, -10 -16, 0 -28 C 2 -18, 9 -14, 8 -4 C 6 2, 3 4, 0 4Z"/>
        <path class="flame f3" d="M0 4 C -5 2, -5 -6, 0 -14 C 2 -8, 5 -5, 4 0 C 3 3, 1 4, 0 4Z"/>
      </g>
    </g>
    <text class="breath-word in" x="400" y="372" text-anchor="middle">breathe in</text>
    <text class="breath-word out" x="400" y="372" text-anchor="middle">breathe out</text>
  </svg>`;
}

function skySection() {
  if (!G) return "";
  const lit = new Set([...(S.thinking?.days ?? []), ...(S.innerScreen?.proprioception?.days ?? [])]);
  const since = Date.parse(G.today) - 27 * 864e5;
  const n = [...lit].filter((d) => Date.parse(d) >= since && Date.parse(d) <= Date.parse(G.today)).length;
  const age = moonAge(new Date(G.today + "T21:00"));
  const pct = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100);
  const spells = S.thinking?.spells?.length ?? 0;
  return `<section class="garden-wrap sky-wrap" aria-label="Inner sky">
    <h2 class="map-title">Inner sky</h2>
    <div class="garden sky">${skySvg()}</div>
    <div class="legend"><span>✦ practised on ${n} of the last 28 days</span><span>☾ ${esc(moonName(age))}, ${pct}% lit</span>${spells ? `<span>🌬️ ${spells} spell${spells > 1 ? "s" : ""} adrift</span>` : ""}<span class="muted">breathe with the halo: in for four, out for six</span></div>
  </section>`;
}

function nowSection() {
  const now = S.config.now ?? [];
  if (!now.length) return `<section class="panel now"><h2>Now</h2>
    <p class="muted">Nothing named yet. <button class="tiny" data-run="/kin:hearth">Refresh</button> reads what the skills wrote lately and fills this.</p></section>`;
  return `<section class="panel now"><h2>Now <button class="tiny ghost" data-run="/kin:hearth" title="Read what the skills wrote lately and refresh the dashboard">refresh</button></h2>
    <div class="now-list">${now.map((n) => {
      const left = daysUntil(n.until);
      return `<div class="now-item"><div><strong>${esc(n.what)}</strong>${n.until ? ` <span class="${left != null && left <= 3 ? "badge" : "muted"}">${left != null && left < 0 ? "passed" : left === 0 ? "today" : `until ${esc(day(n.until))}`}</span>` : ""}
        ${n.why ? `<p class="muted">${esc(n.why)}</p>` : ""}</div>
        ${n.run ? `<button class="tiny" data-run="${esc(n.run)}">Begin</button>` : ""}</div>`;
    }).join("")}</div></section>`;
}

/* ---------- embers: one thing from the logs, brought back ---------- */

// Older than a week, so it has had time to cool. An echo (a year, a season, a month ago today, give or take two days)
// comes first; the rest follow in an order fixed for the day. "Another" walks on from there.
const ECHOES = [[365, "a year ago today"], [182, "half a year ago"], [91, "a season ago"], [30, "a month ago"]];
const EMBER_GLYPH = { moment: "🫀", practice: "🕯️", spell: "🌬️", tending: "🌱" };
let emberStep = 0;
function emberOrder() {
  const today = Date.parse(G.today);
  const old = (S.embers ?? []).filter((e) => today - Date.parse(e.date) >= 7 * 864e5);
  const echoOf = (e) => ECHOES.find(([d]) => Math.abs((today - Date.parse(e.date)) / 864e5 - d) <= 2)?.[1] ?? null;
  const key = (e) => hash(G.today + e.date + e.title);
  const echoes = ECHOES.flatMap(([, label]) => old.filter((e) => echoOf(e) === label));
  const rest = old.filter((e) => !echoOf(e)).sort((a, b) => key(a) - key(b));
  return [...echoes, ...rest].map((e) => ({ ...e, echo: echoOf(e) }));
}
function emberAgo(date) {
  const n = Math.round((Date.parse(G.today) - Date.parse(date)) / 864e5);
  return n < 14 ? `${n} days ago` : n < 60 ? `${Math.round(n / 7)} weeks ago` : n < 548 ? `${Math.round(n / 30.4)} months ago` : `${Math.round(n / 365)} years ago`;
}
function emberSection() {
  const all = G ? emberOrder() : [];
  if (!all.length) return "";
  const e = all[emberStep % all.length];
  const when = new Date(e.date + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const prompt = `Bring back this ember from my ${e.note} note, ${e.date}: "${e.title}". Read that entry in the vault, tell me in two lines what I wrote then, and ask me one question about what has moved since. Don't write anything to the vault unless I ask.`;
  return `<section class="panel kindle" aria-label="An ember from your logs">
    <div class="kindle-glyph" aria-hidden="true">${EMBER_GLYPH[e.kind] ?? "✦"}</div>
    <div class="kindle-body">
      <div class="label">An ember · ${esc(e.echo ?? emberAgo(e.date))}</div>
      <h3>${esc(e.title)}</h3>
      ${e.html ? `<div class="html">${e.html}</div>` : ""}
      <p class="muted kindle-from">${esc(when)} · <a href="${obsidianLink(e.note)}">${esc(e.note)}</a></p>
    </div>
    <div class="kindle-buttons">
      <button class="tiny" data-run="${esc(prompt)}" title="Ask your AI buddy to sit with this one">Sit with it</button>
      ${all.length > 1 ? `<button class="tiny ghost" data-ember-next title="Another one (${all.length} to draw from)">Another</button>` : ""}
    </div>
  </section>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ember-next]");
  if (!b) return;
  emberStep++;
  b.closest(".kindle").outerHTML = emberSection();
});

function innerScreen() {
  if (!S) return "";
  return [
    skySection(),
    nowSection(),
    emberSection(),
    innerLaunch(),
    soilSection(),
    `<div class="inner-cols">${proprioceptionSection()}${thinkingSection()}</div>`,
    `<div class="inner-cols">${coordinationSection()}${notesSection()}</div>`,
  ].join("");
}

/* ---------- main menu ---------- */

let MENU = [];
let menuError = "";
async function loadMenu() {
  try {
    const res = await fetch("/api/menu");
    menuError = res.ok ? "" : res.status === 404 ? "This server predates the menu: stop it and open Hearth again." : `The menu did not load (${res.status}).`;
    if (res.ok) { MENU = await res.json(); if (S) $("#innerScreen").innerHTML = innerScreen(); }
  } catch (e) {
    menuError = `The menu did not load: ${e.message}`;
  }
}

function renderMenu() {
  const q = $("#menuSearch").value.trim().toLowerCase();
  const hit = (...xs) => !q || xs.some((x) => String(x ?? "").toLowerCase().includes(q));
  const hearth = (S?.config.actions ?? [])
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => hit(a.label, a.hint, a.prompt))
    .map(({ a, i }) => `<button class="menu-item" data-action="${i}"><span><span class="menu-name">${esc(a.label)}</span><span class="menu-hint">${esc(a.hint ?? "")}</span></span></button>`)
    .join("");
  const groups = MENU.map((g) => {
    const items = g.items.filter((it) => hit(it.name, it.hint, it.command, g.plugin, ...(SKILL_MODES[it.command] ?? []).map((m) => m[2])));
    if (!items.length) return "";
    return `<section class="menu-group"><h3>${g.icon} ${esc(g.plugin)}</h3><div class="menu">${items.map((it) => {
      const modes = SKILL_MODES[it.command];
      return `<div class="menu-cell"><button class="menu-item" data-run="${esc(it.command)}" title="${esc(it.command)}"><span><span class="menu-name">${esc(it.name)}</span><span class="menu-hint">${esc(it.hint)}</span></span></button>
        ${modes ? `<div class="chips menu-modes">${modes.map(([icon, label, arg]) => `<button class="chip" data-run="${esc(`${it.command} ${arg}`)}">${icon} ${esc(label)}</button>`).join("")}</div>` : ""}</div>`;
    }).join("")}</div></section>`;
  }).join("");
  $("#menuBody").innerHTML =
    (hearth ? `<section class="menu-group"><h3>🔥 hearth</h3><div class="menu">${hearth}</div></section>` : "") +
    (groups || (MENU.length ? "" : `<p class="muted">${esc(menuError || "No buchecha checkout found, so only the hearth's own actions are here.")}</p>`)) ||
    `<p class="muted">Nothing matches “${esc(q)}”.</p>`;
}

async function openMenu() {
  if (!MENU.length) await loadMenu();
  $("#menuSearch").value = "";
  renderMenu();
  $("#menu").showModal();
  $("#menuSearch").focus();
}
$("#menuOpen").onclick = openMenu;
loadMenu();
$("#menuSearch").addEventListener("input", renderMenu);
$("#menuSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  $("#menuBody .menu-item")?.click();
});
$("#menu").addEventListener("click", (e) => { if (e.target === $("#menu")) $("#menu").close(); });
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  $("#menu").open ? $("#menu").close() : openMenu();
});

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
    <p class="muted">${esc(RING_NAME[p.ring])}${p.placeLabel ? ` · ${esc(p.placeLabel)}` : ""} · every ${spanText(p.interval)}${p.replyWithin ? `, reply within ${spanText(p.replyWithin)}` : ""}</p>
    <p class="since-line t-${esc(p.thirst)}"><i class="tdot t-${esc(p.thirst)}"></i>${esc(sinceText(p))}${p.lastTendedFrom ? ` <span class="muted">· from ${esc(FROM[p.lastTendedFrom] ?? p.lastTendedFrom)}</span>` : ""}</p>
    ${p.note ? `<p class="note">${esc(p.note.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1"))}</p>` : ""}
    ${p.nextBirthday ? `<p class="muted">🎂 ${esc(birthdayDay(p.nextBirthday.date))} · ${birthdayWhen(p.nextBirthday.in)}</p>` : ""}
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
  } else if (t.dataset.action != null) { if ($("#menu").open) $("#menu").close(); startNew(S.config.actions[+t.dataset.action].prompt); }
  else if (t.dataset.run != null) { for (const d of ["#sheet", "#menu"]) if ($(d).open) $(d).close(); startNew(t.dataset.run); }
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
  // The stream dropped: check the server, so a dead one leads to the next server rather than waiting.
  es.onerror = () => { clearTimeout(timer); timer = setTimeout(load, 1000); };
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
  $("#rail").title = waitingPermissions ? "Your AI buddy is waiting for your approval" : running ? "Your AI buddy is working" : "Open the conversation (\\)";
}

/* ---------- chat ---------- */

let sessionId = null;
let running = false;
let bubble = null;
let bubbleText = "";

function scrollLog() { const l = $("#log"); l.scrollTop = l.scrollHeight; }

/* Copy: a small button at the foot of each message that puts its text, as written, on the clipboard. */
const ICON_COPY = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>`;
const ICON_COPIED = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
function copyable(el, text) {
  el.dataset.copy = text;
  el.insertAdjacentHTML("beforeend", `<div class="msg-foot"><button type="button" class="copy" data-copy-msg title="Copy" aria-label="Copy this message">${ICON_COPY}</button></div>`);
  return el;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Without a secure context (plain http off this Mac) the clipboard API is missing: fall back to a hidden textarea.
  const t = Object.assign(document.createElement("textarea"), { value: text });
  t.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(t); t.select();
  const ok = document.execCommand("copy");
  t.remove();
  return ok;
}
$("#log").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy-msg]");
  if (!b) return;
  const ok = await copyText(b.closest(".msg").dataset.copy ?? "");
  b.innerHTML = ok ? ICON_COPIED : ICON_COPY;
  b.title = ok ? "Copied" : "Could not copy";
  b.classList.toggle("done", ok);
  clearTimeout(b._t);
  b._t = setTimeout(() => { b.innerHTML = ICON_COPY; b.title = "Copy"; b.classList.remove("done"); }, 1500);
});

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

/* Tool calls fold into one collapsed "N steps" row per stretch between replies; click to see them. */
function addStep(name, detail = "") {
  const log = $("#log");
  let last = log.lastElementChild;
  while (last && (last === work || last === queueEl)) last = last.previousElementSibling;
  const box = last?.classList.contains("steps") ? last : append("steps", `<details><summary></summary><div class="steps-list"></div></details>`);
  const row = document.createElement("div");
  row.className = "tool";
  row.innerHTML = `↳ ${esc(name)}${detail ? ` · ${esc(detail)}` : ""}`;
  $(".steps-list", box).appendChild(row);
  const n = $(".steps-list", box).children.length;
  $("summary", box).innerHTML = `${n} step${n === 1 ? "" : "s"} <span class="muted">· ${esc(name)}</span>`;
  scrollLog();
}

/* A reply that ends in [[confirm]] is a yes or no question: the marker is hidden and Yes / No buttons follow the turn.
   While it streams, a half-written marker at the end is hidden too. */
const CONFIRM = /\s*\[\[confirm\]\]\s*$/;
const unmark = (t) => t.replace(CONFIRM, "").replace(/\s*\[\[[a-z]{0,7}\]?$/, "");

function light(text) {
  // Escape first, then a little markdown: bold, italics, bullets, paragraphs.
  const blocks = esc(unmark(text)).split(/\n{2,}/);
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
  if (fab) setFab(fab, asking ? "✋" : "💬", asking ? "Approve in Conversation" : `AI buddy is ${workText.toLowerCase()}…`);
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
// The phone's conversation button is an emoji; what it means goes in its label. It glows while Claude works.
function setFab(fab, emoji, label) { fab.textContent = emoji; fab.title = label; fab.setAttribute("aria-label", label); }
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
    const fab = $("#openChat"); if (fab) setFab(fab, "💬", "Conversation");
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
    <div class="proposal-head"><strong>Send this to your AI buddy?</strong>
      <span class="muted">${thread ? "You are in a conversation." : "Edit it first if you like."}</span></div>
    <textarea rows="2" aria-label="Prompt to send"></textarea>
    <div class="chat-buttons">
      <button type="button" class="ghost" data-cancel>Cancel</button>
      ${thread ? `<button type="button" class="ghost" data-here>Send in this conversation</button>` : ""}
      <button type="button" class="primary" data-new>${thread ? "Start new conversation" : "Send"}</button>
    </div>
    <p class="muted proposal-note" hidden>Your AI buddy is still working. You can send when the turn ends.</p>`);
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

/* A turn that failed or ended without a word gets a Retry under it, which sends the same message again.
   After Stop it does not: stopping was the point. */
let retryEl = null;
let replied = false;
let failed = false;

function offerRetry(message) {
  retryEl = append("retry", `<span class="muted">${failed ? "That did not go through." : "No reply came back."}</span>
    <button type="button" class="ghost">Retry</button>`);
  $("button", retryEl).onclick = () => send(message, true);
}

/* Yes / No under a reply that asked one. A press answers with that word; typing an answer instead takes the buttons away.
   They only answer Claude: a Beeper change it then makes still meets the Allow card unless Auto-allow covers it. */
let confirmEl = null;
let asked = false;

function offerConfirm() {
  confirmEl = append("confirm", `<div class="chat-buttons"><button type="button" class="ghost" data-no>No</button><button type="button" class="primary" data-yes>Yes</button></div>`);
  // send() takes the buttons away and shows the word as his message.
  $("[data-yes]", confirmEl).onclick = () => running || send("Yes");
  $("[data-no]", confirmEl).onclick = () => running || send("No");
}

async function send(message, again = false) {
  if (!message.trim()) return;
  if (running) { queue.push(message.trim()); renderQueue(); return; }
  stopAsked = false;
  retryEl?.remove(); retryEl = null;
  confirmEl?.remove(); confirmEl = null;
  replied = failed = asked = false;
  if (!again) copyable(append("msg user", esc(message)), message);
  bubble = null; bubbleText = "";
  setRunning(true);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, ...(sessionId && { sessionId }), ...($("#model").value && { model: $("#model").value }), ...(autoAllow !== "off" && { autoAllow }) }),
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
    failed = true;
    append("msg error", esc(e.message));
  } finally {
    waitingPermissions = 0;
    setRunning(false);
    if ((failed || !replied) && !stopAsked) offerRetry(message);
    else if (asked && !stopAsked && !queue.length) offerConfirm();
    flushQueue();
  }
}

function handle(ev) {
  switch (ev.type) {
    case "session": sessionId = ev.sessionId; break;
    case "status": if (ev.text === "stopped") setActivity("Stopping"); break;
    case "activity": setActivity(ev.text); break;
    case "text":
      replied = true;
      if (!bubble) bubble = append("msg assistant", "");
      bubbleText += ev.delta;
      bubble.innerHTML = light(bubbleText);
      copyable(bubble, unmark(bubbleText));
      if (work) $("#log").appendChild(work);
      scrollLog();
      break;
    case "tool":
      bubble = null; bubbleText = "";
      addStep(ev.name, ev.summary);
      break;
    case "permission": {
      bubble = null; bubbleText = "";
      waitingPermissions++;
      updateRailDot();
      const el = append("perm", `<strong>Your AI buddy wants to use ${esc(ev.tool)}</strong><pre>${esc(ev.summary)}</pre>
        <input class="why" type="text" maxlength="500" placeholder="Why not? (optional, sent with Deny)">
        <div class="chat-buttons"><button class="ghost" data-deny>Deny</button><button class="primary" data-allow>Allow</button></div>`);
      const decide = async (allow) => {
        if (!el.isConnected || !$(".chat-buttons", el)) return;
        delete el.dataset.opensAt;
        const why = allow ? "" : $(".why", el).value.trim();
        $(".why", el).remove();
        $(".chat-buttons", el).outerHTML = `<div class="done">${allow ? "Allowed" : "Denied"}${why ? `: ${esc(why)}` : ""}</div>`;
        waitingPermissions = Math.max(0, waitingPermissions - 1);
        updateRailDot();
        renderWork();
        await fetch("/api/permission", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ev.id, allow, why }) });
      };
      $("[data-allow]", el).onclick = () => decide(true);
      $("[data-deny]", el).onclick = () => decide(false);
      // Enter in the why box denies; it never allows by accident.
      $(".why", el).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); decide(false); } };
      // The server says which Auto-allow may answer this card for you: "most" (off Beeper), "all" (a Beeper send), or
      // none, for other Beeper changes, which always wait.
      if (ev.opensAt) el.dataset.opensAt = ev.opensAt;
      if (covers(ev.opensAt)) decide(true);
      renderWork();
      break;
    }
    case "done":
      if (ev.isError) { failed = true; append("msg error", esc(ev.result || "The turn ended with an error.")); }
      asked = !!bubble && CONFIRM.test(bubbleText);
      append("stamp", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      break;
    case "error": failed = true; append("msg error", esc(ev.message)); break;
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
  if ($(".msg", $("#log")) && !confirm("Start a new conversation? This one stays in your AI buddy's history but leaves this panel.")) return;
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

/* Auto-allow, three steps the button cycles through. Off: the card for anything outside the vault. Most: every tool runs
   without the card except Beeper changes, sends included. All: Beeper sends go through too; other Beeper changes
   (archive, edit, delete…) always ask. Off by default; each browser remembers its own choice ("1" was the old on).
   Stepping up mid-turn also allows the cards already waiting that the new step covers. */
const AUTO = {
  off: { label: "Auto-allow off", pressed: "false", title: "Your AI buddy asks before tools outside the vault. Click to let it run them without asking, Beeper changes still ask" },
  most: { label: "Auto-allow, Beeper asks", pressed: "mixed", title: "Your AI buddy runs every tool without asking, but asks before anything that changes Beeper, sends included. Click to let Beeper sends through too" },
  all: { label: "Auto-allow on", pressed: "true", title: "Your AI buddy runs every tool and sends Beeper messages without asking (other Beeper changes still ask). Click to turn it off" },
};
const savedAuto = store.get("hearth.autoAllow");
let autoAllow = savedAuto === "1" ? "all" : Object.hasOwn(AUTO, savedAuto ?? "") ? savedAuto : "off";
const RANK = { off: 0, most: 1, all: 2 };
const covers = (opensAt) => !!opensAt && autoAllow !== "off" && RANK[autoAllow] >= RANK[opensAt];
function showAutoAllow() {
  const b = $("#autoAllow"), a = AUTO[autoAllow];
  b.querySelector(".label").textContent = a.label;
  b.setAttribute("aria-label", a.label);
  b.title = a.title;
  b.setAttribute("aria-pressed", a.pressed);
}
showAutoAllow();
$("#autoAllow").onclick = () => {
  autoAllow = { off: "most", most: "all", all: "off" }[autoAllow];
  store.set("hearth.autoAllow", autoAllow);
  showAutoAllow();
  document.querySelectorAll("#log .perm[data-opens-at]").forEach((el) => { if (covers(el.dataset.opensAt)) $("[data-allow]", el)?.click(); });
};

/* Stop the server from the page. The launcher (Hearth.app) starts it again. */
$("#logout").onclick = () => $("#logoutForm").submit();

/* Lock on its own after HEARTH_LOCK_AFTER seconds (30 by default) with no input, when a password is set. Never while Claude is
   working: locking would cut the reply off. A hidden tab's timers sleep, so check on return too.
   Off by default; each browser can turn it on, and the choice is remembered. */
const lockAfter = () => S?.lockAfter ?? 30;
let lastInput = Date.now();
let autoLock = store.get("hearth.autoLock") === "1";
function showAutoLock() {
  const b = $("#autoLock");
  b.textContent = autoLock ? "⏱ Auto-lock on" : "⏱ Auto-lock off";
  b.title = autoLock
    ? `Locks this browser after ${lockAfter()} seconds with no input. Click to turn it off`
    : "Auto-lock is off on this browser. Click to turn it on";
  b.setAttribute("aria-pressed", String(autoLock));
}
showAutoLock();
$("#autoLock").onclick = () => {
  autoLock = !autoLock;
  store.set("hearth.autoLock", autoLock ? "1" : "0");
  lastInput = Date.now();
  showAutoLock();
};
for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"])
  addEventListener(ev, () => (lastInput = Date.now()), { passive: true, capture: true });
function lockIfIdle() {
  if (!S?.auth || !autoLock || stopped) return;
  if (running) return void (lastInput = Date.now());
  if (Date.now() - lastInput >= lockAfter() * 1000) $("#logoutForm").submit();
}
setInterval(lockIfIdle, 1000);
document.addEventListener("visibilitychange", lockIfIdle);

$("#shutdown").onclick = async () => {
  if (!confirm("Stop the Hearth server? Open Hearth.app to start it again.")) return;
  try { await fetch("/api/shutdown", { method: "POST" }); } catch {}
  stopped = true;
  clearTimeout(retry);
  events?.close();
  document.body.innerHTML = `<main class="stopped"><h1>Hearth is resting</h1>
    <p class="muted">The server is stopped. Open <strong>Hearth.app</strong> in Applications to light it again.</p>
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

// A clock turning back for the list of past conversations; an arrow back to this one while it is open.
const ICON_HISTORY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>`;
function showHistoryIcon(open) {
  const b = $("#historyBtn");
  b.innerHTML = open ? ICON_BACK : ICON_HISTORY;
  b.title = open ? "Back to this conversation" : "Previous conversations";
  b.setAttribute("aria-label", b.title);
}

function showHistory(on) {
  $("#history").hidden = !on;
  $("#log").hidden = on;
  $("#historyBtn").setAttribute("aria-expanded", String(on));
  showHistoryIcon(on);
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
  if (running) { toast("Your AI buddy is still working. Stop the turn first."); return; }
  if (id === sessionId) { showHistory(false); return; }
  if ($(".msg", $("#log")) && !confirm("Open this conversation? The one in the panel stays in History.")) return;
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  const lines = res.ok ? await res.json() : null;
  if (!Array.isArray(lines) || !lines.length) { toast("That conversation could not be read back."); return; }
  showHistory(false);
  sessionId = id;
  proposal = null;
  bubble = null; bubbleText = "";
  $("#log").innerHTML = `<p class="muted hint">An earlier conversation. Write below to continue it.</p>`;
  for (const l of lines) {
    if (l.kind === "user") copyable(append("msg user", esc(l.text)), l.text);
    else if (l.kind === "assistant") copyable(append("msg assistant", light(l.text)), unmark(l.text));
    else { const [name, ...rest] = l.text.split(" · "); addStep(name, rest.join(" · ")); }
  }
  $("#chatStatus").textContent = "continuing";
}

/* Locking leaves the page through the login form. This tab remembers which conversation was open (its id, never its text)
   and opens it again after the password. A new tab starts fresh. */
const OPEN_KEY = "hearth.openSession";
addEventListener("pagehide", () => {
  try { sessionId ? sessionStorage.setItem(OPEN_KEY, sessionId) : sessionStorage.removeItem(OPEN_KEY); } catch {}
});
(() => {
  let id = null;
  try { id = sessionStorage.getItem(OPEN_KEY); } catch {}
  if (id) openSession(id).catch(() => {});
})();

$("#historyBtn").onclick = () => showHistory($("#history").hidden);
showHistoryIcon(false);
$("#history").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    if (!confirm("Delete this conversation for good? It is removed from your AI buddy's history too.")) return;
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
