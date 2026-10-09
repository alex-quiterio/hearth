// Ember: a small, silly game for when the server is down. Loaded with the page, so it runs with no server.
// You are a fire with eyes. Eat twigs and pinecones, dodge the rain, and do not go out.

window.emberGame = function emberGame(host) {
  const css = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
  const C = { bg: css("--surface", "#fbf6ec"), ink: css("--ink", "#2c2820"), muted: css("--muted", "#8e8a7b"),
    amber: css("--amber", "#e8a33d"), clay: css("--clay", "#c4572e"), moss: css("--moss", "#4d7a39"), water: css("--water", "#79b4e2") };
  const BEST = "hearth.ember.best";
  const best = () => { try { return +localStorage.getItem(BEST) || 0; } catch { return 0; } };

  host.innerHTML = `<div class="ember-game">
    <canvas width="480" height="320" aria-label="Ember, a small game. Move with the arrow keys, the mouse or a finger."></canvas>
    <p class="muted ember-help">← → or mouse to move · eat <b>twigs</b> and <b>pinecones</b> · dodge <b>rain</b> · space to start</p></div>`;
  const cv = host.querySelector("canvas");
  const g = cv.getContext("2d");
  const W = cv.width, H = cv.height, FLOOR = H - 28;

  const QUIPS = {
    twig: ["crunchy", "yum", "fibre!", "nom"], cone: ["PINECONE!", "jackpot", "a delicacy"],
    sock: ["…a sock?", "smells like feet", "why is there a sock"], rain: ["ow", "pssst", "rude", "cold!"],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  let s, keys = {}, raf = 0, last = 0, pointerX = null;
  const reset = () => (s = { x: W / 2, fuel: 60, t: 0, eaten: 0, items: [], words: [], over: false, started: false, spawn: 0, blink: 0 });
  reset();

  function spawn() {
    const level = 1 + s.t / 20;
    const r = Math.random();
    const kind = r < 0.5 ? "twig" : r < 0.58 ? "cone" : r < 0.63 ? "sock" : "rain";
    s.items.push({ kind, x: 16 + Math.random() * (W - 32), y: -10, vy: (kind === "rain" ? 120 : 70) * (0.8 + Math.random() * 0.5) * Math.min(level, 3),
      wob: Math.random() * 6 });
    s.spawn = Math.max(0.18, 0.9 / level);
  }

  function step(dt) {
    if (!s.started || s.over) return;
    s.t += dt;
    s.fuel -= dt * (5 + s.t / 15);
    const speed = 260;
    if (keys.ArrowLeft || keys.a) s.x -= speed * dt;
    if (keys.ArrowRight || keys.d) s.x += speed * dt;
    if (pointerX != null) s.x += Math.max(-speed * dt, Math.min(speed * dt, pointerX - s.x));
    s.x = Math.max(20, Math.min(W - 20, s.x));
    if ((s.spawn -= dt) <= 0) spawn();
    const size = 14 + s.fuel / 5;
    for (const it of s.items) {
      it.y += it.vy * dt;
      if (it.y > FLOOR - size && it.y < FLOOR + 6 && Math.abs(it.x - s.x) < size * 0.8) {
        it.gone = true;
        const gain = { twig: 12, cone: 28, sock: -6, rain: -18 }[it.kind];
        s.fuel = Math.min(100, s.fuel + gain);
        if (gain > 0) s.eaten++;
        s.words.push({ text: pick(QUIPS[it.kind]), x: s.x, y: FLOOR - size - 10, life: 1, bad: gain < 0 });
      }
      if (it.y > H + 10) it.gone = true;
    }
    s.items = s.items.filter((i) => !i.gone);
    for (const w of s.words) { w.y -= 30 * dt; w.life -= dt; }
    s.words = s.words.filter((w) => w.life > 0);
    if (s.fuel <= 0) {
      s.fuel = 0; s.over = true; s.items = [];
      if (Math.floor(s.t) > best()) try { localStorage.setItem(BEST, String(Math.floor(s.t))); } catch {}
    }
  }

  function drawItem(it) {
    g.save(); g.translate(it.x, it.y);
    if (it.kind === "twig") {
      g.rotate(Math.sin(it.y / 30 + it.wob) * 0.6);
      g.strokeStyle = "#8a5a33"; g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(-10, 0); g.lineTo(10, 0); g.moveTo(3, 0); g.lineTo(8, -6); g.stroke();
    } else if (it.kind === "cone") {
      g.fillStyle = "#7a4a28";
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(0, -6 + i * 4, 7 - i, 3, 0, 0, Math.PI * 2); g.fill(); }
    } else if (it.kind === "sock") {
      g.rotate(Math.sin(it.y / 20) * 0.5);
      g.fillStyle = C.clay; g.fillRect(-4, -10, 8, 12); g.fillRect(-4, 0, 13, 7);
      g.fillStyle = "#fff"; g.fillRect(-4, -10, 8, 3);
    } else {
      g.fillStyle = C.water;
      g.beginPath(); g.moveTo(0, -8); g.quadraticCurveTo(6, 2, 0, 5); g.quadraticCurveTo(-6, 2, 0, -8); g.fill();
    }
    g.restore();
  }

  function drawFire(now) {
    const size = s.over ? 6 : 14 + s.fuel / 5;
    const flick = (k) => Math.sin(now / (90 + k * 30) + k) * size * 0.12;
    g.save(); g.translate(s.x, FLOOR);
    g.fillStyle = "#6b4426"; g.fillRect(-size * 0.9, -4, size * 1.8, 6);
    if (s.over) {
      g.fillStyle = C.muted; g.globalAlpha = 0.6;
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(Math.sin(now / 400 + i) * 6, -14 - i * 14 - (now / 40 % 14), 5 + i * 2, 0, Math.PI * 2); g.fill(); }
      g.restore(); return;
    }
    const layer = (color, scale, k) => {
      g.fillStyle = color; g.beginPath();
      g.moveTo(-size * scale, 0);
      g.quadraticCurveTo(-size * scale * 1.1, -size * scale * 1.2, flick(k), -size * scale * 2.2);
      g.quadraticCurveTo(size * scale * 1.1, -size * scale * 1.2, size * scale, 0);
      g.fill();
    };
    layer(C.clay, 1, 1); layer(C.amber, 0.7, 2); layer("#fff3c4", 0.35, 3);
    // googly eyes, looking at whatever falls closest
    const target = s.items.reduce((a, b) => (!a || b.y > a.y ? b : a), null);
    const blinking = (now % 3200) < 120;
    for (const side of [-1, 1]) {
      const ex = side * size * 0.32, ey = -size * 0.95;
      g.fillStyle = "#fff"; g.beginPath(); g.ellipse(ex, ey, size * 0.2, blinking ? 1 : size * 0.22, 0, 0, Math.PI * 2); g.fill();
      if (!blinking) {
        const a = target ? Math.atan2(target.y - (FLOOR + ey), target.x - (s.x + ex)) : Math.PI / 2;
        g.fillStyle = "#222"; g.beginPath(); g.arc(ex + Math.cos(a) * size * 0.08, ey + Math.sin(a) * size * 0.08, size * 0.1, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  function draw(now) {
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = C.moss; g.globalAlpha = 0.25; g.fillRect(0, FLOOR + 2, W, H - FLOOR); g.globalAlpha = 1;
    s.items.forEach(drawItem);
    drawFire(now);
    g.font = "600 13px system-ui, sans-serif"; g.textAlign = "center";
    for (const w of s.words) { g.globalAlpha = Math.max(0, w.life); g.fillStyle = w.bad ? C.water : C.clay; g.fillText(w.text, w.x, w.y); }
    g.globalAlpha = 1;
    // fuel bar and score
    g.fillStyle = C.muted; g.globalAlpha = 0.25; g.fillRect(12, 12, 120, 8); g.globalAlpha = 1;
    g.fillStyle = s.fuel < 25 ? C.water : C.amber; g.fillRect(12, 12, 1.2 * s.fuel, 8);
    g.textAlign = "right"; g.fillStyle = C.ink; g.font = "13px system-ui, sans-serif";
    g.fillText(`${Math.floor(s.t)}s · ${s.eaten} eaten · best ${best()}s`, W - 12, 20);
    g.textAlign = "center";
    if (!s.started || s.over) {
      g.fillStyle = C.ink; g.font = "600 20px Fraunces, Georgia, serif";
      g.fillText(s.over ? `You went out after ${Math.floor(s.t)} seconds` : "Keep the ember alive", W / 2, H / 2 - 30);
      g.font = "14px system-ui, sans-serif"; g.fillStyle = C.muted;
      g.fillText(s.over ? (s.t < 10 ? "the rain sends its regards" : s.t < 40 ? "a respectable smoulder" : "a legendary blaze") : "press space or click to start", W / 2, H / 2 - 6);
      if (s.over) g.fillText("space or click to try again", W / 2, H / 2 + 16);
    }
  }

  function frame(now) {
    if (!cv.isConnected) return stop(); // the page came back and replaced us
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    step(dt); draw(now);
    raf = requestAnimationFrame(frame);
  }

  const start = () => { if (s.over) reset(); if (!s.started) { s.started = true; spawn(); } };
  const onKey = (e) => {
    if (!cv.isConnected) return;
    if (e.type === "keydown" && (e.key === " " || e.key === "Enter")) { e.preventDefault(); start(); }
    if (e.key.startsWith("Arrow")) e.preventDefault();
    keys[e.key] = e.type === "keydown";
  };
  const toX = (e) => ((e.clientX - cv.getBoundingClientRect().left) / cv.getBoundingClientRect().width) * W;
  cv.addEventListener("pointermove", (e) => (pointerX = toX(e)));
  cv.addEventListener("pointerleave", () => (pointerX = null));
  cv.addEventListener("pointerdown", (e) => { pointerX = toX(e); start(); });
  addEventListener("keydown", onKey);
  addEventListener("keyup", onKey);
  function stop() { cancelAnimationFrame(raf); removeEventListener("keydown", onKey); removeEventListener("keyup", onKey); }
  raf = requestAnimationFrame(frame);
  cv.focus?.();
  return stop;
};
