import { join } from "node:path";
import { watch } from "node:fs";
import { findVault, state, lastChange, kinState, kinPeople, PATHS, VAULT_NAME } from "./vault";
import { waterPlant } from "./garden";
import { chat, answerPermission, stop, listModels, type AutoAllow } from "./agent";
import { sessions, transcript, forget } from "./history";
import { saveAttachment, vaultFile, sweepAttachments, type Attachment } from "./attach";
import { loadAuth, authed, login, logout, onThisMac, AUTH_FILE } from "./auth";
import { menu } from "./menu";
import { talk, beeperOn, shifts, unread, rhythms } from "./beeper";

const vault = await findVault();
const PORT = Number(process.env.HEARTH_PORT ?? 4747);
const LOCK_AFTER = Number(process.env.HEARTH_LOCK_AFTER ?? 30); // seconds of no input before auto-lock
const PUBLIC = join(import.meta.dir, "../public");
// The app version: the checkout's commit, read on every page load so a refresh shows the latest.
// A trailing + means uncommitted changes. The page is read fresh each time too; `bun run dev` restarts the server when src/ changes.
const version = () =>
  Bun.spawnSync(["git", "describe", "--always", "--abbrev=5", "--dirty=+"], { cwd: import.meta.dir }).stdout.toString().trim() || "?";
const page = async (name: string) =>
  new Response((await Bun.file(join(PUBLIC, name)).text()).replace("<!--SHA-->", version()), { headers: { "content-type": "text/html; charset=utf-8" } });

// Vault change fan-out: one watcher per folder, debounced, broadcast to every open tab.
const listeners = new Set<(at: number) => void>();
let debounce: Timer | null = null;
for (const rel of [PATHS.kinDir, PATHS.conversations, PATHS.practiceDir]) {
  try {
    watch(join(vault, rel), () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => listeners.forEach((l) => l(Date.now())), 400);
    });
  } catch (e) {
    console.warn(`not watching ${rel}: ${(e as Error).message}`);
  }
}
// Cloud-synced folders do not always emit fs events; poll as a backstop.
let seen = await lastChange(vault);
setInterval(async () => {
  const now = await lastChange(vault);
  if (now > seen) {
    seen = now;
    listeners.forEach((l) => l(Date.now()));
  }
}, 5000);

sweepAttachments();
setInterval(sweepAttachments, 3600 * 1000);

const hasPassword = await loadAuth();

// Everything except the login page and what it needs is behind the password.
// The app's manifest, icons and service worker are open too: Android fetches them without the cookie, and they hold nothing private.
const APP_FILES = ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "icon-maskable.png", "apple-touch-icon.png"];
const APP_HEADERS: Record<string, ResponseInit> = {
  "manifest.webmanifest": { headers: { "content-type": "application/manifest+json" } },
  "sw.js": { headers: { "cache-control": "no-cache" } },
};
// ember.js is the small game at the bottom of the login page; it holds nothing private.
const OPEN = new Set(["/login", "/style.css", "/ember.js", "/favicon.svg", "/favicon.ico", ...APP_FILES.map((f) => `/${f}`)]);
type Handler = (req: any) => Response | Promise<Response>;
function guard(h: Handler): Handler {
  return (req: Request) => {
    if (authed(req)) return h(req);
    if (new URL(req.url).pathname.startsWith("/api/")) return Response.json({ error: "log in first" }, { status: 401 });
    return Response.redirect("/login", 303);
  };
}
function guardAll<T extends Record<string, Handler | Record<string, Handler>>>(routes: T): T {
  const out: Record<string, unknown> = {};
  for (const [path, r] of Object.entries(routes)) {
    out[path] = OPEN.has(path) ? r
      : typeof r === "function" ? guard(r)
      : Object.fromEntries(Object.entries(r).map(([m, h]) => [m, guard(h)]));
  }
  return out as T;
}

const sse = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

Bun.serve({
  hostname: "127.0.0.1", // never off this machine: the vault holds inner work
  port: PORT,
  idleTimeout: 0,
  routes: guardAll({
    "/login": {
      GET: (req) => (authed(req) ? Response.redirect("/", 303) : page("login.html")),
      POST: login,
    },
    "/logout": { POST: logout },

    "/": () => page("index.html"),
    "/app.js": () => new Response(Bun.file(join(PUBLIC, "app.js"))),
    "/ember.js": () => new Response(Bun.file(join(PUBLIC, "ember.js"))),
    "/style.css": () => new Response(Bun.file(join(PUBLIC, "style.css"))),
    "/favicon.svg": () => new Response(Bun.file(join(PUBLIC, "favicon.svg"))),
    "/favicon.ico": () => new Response(Bun.file(join(PUBLIC, "favicon.svg")), { headers: { "content-type": "image/svg+xml" } }),
    ...Object.fromEntries(APP_FILES.map((f) => [`/${f}`, () => new Response(Bun.file(join(PUBLIC, f)), APP_HEADERS[f])])),

    "/api/state": async (req) => Response.json({ ...(await state(vault)), auth: hasPassword, lockAfter: LOCK_AFTER, local: onThisMac(req), beeper: beeperOn() }),
    "/api/menu": async () => Response.json(await menu()),
    // Read fresh from Beeper on every call, so the Talk screen is as current as Beeper is.
    "/api/talk": (req) => {
      if (!beeperOn()) return Response.json({ error: "Beeper is off on this machine" }, { status: 404 });
      const days = Math.min(3650, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 90));
      const t = talk(days);
      return Response.json(t, { status: "error" in t ? 503 : 200 });
    },
    // Who is warming, cooling, gone quiet or waiting on a reply, matched against the kin map.
    "/api/shifts": async () => {
      if (!beeperOn()) return Response.json({ error: "Beeper is off on this machine" }, { status: 404 });
      const kin = kinPeople(await kinState(vault)).map((p) => ({ name: p.name, ring: p.ring, aka: p.aka }));
      const s = shifts(kin);
      return Response.json(s, { status: "error" in s ? 503 : 200 });
    },
    // When each kin person writes and how fast each side answers, from timestamps only.
    "/api/rhythms": async () => {
      if (!beeperOn()) return Response.json({ error: "Beeper is off on this machine" }, { status: 404 });
      const kin = kinPeople(await kinState(vault)).map((p) => ({ name: p.name, ring: p.ring, aka: p.aka }));
      const r = rhythms(kin);
      return Response.json(r, { status: "error" in r ? 503 : 200 });
    },
    // Direct chats with unread messages, and the newest unread lines in each.
    "/api/unread": async () => {
      if (!beeperOn()) return Response.json({ error: "Beeper is off on this machine" }, { status: 404 });
      const kin = kinPeople(await kinState(vault)).map((p) => ({ name: p.name, ring: p.ring, aka: p.aka }));
      const u = unread(kin);
      return Response.json(u, { status: "error" in u ? 503 : 200 });
    },

    "/api/events": (req) => {
      let send: (at: number) => void;
      const stream = new ReadableStream({
        start(c) {
          send = (at) => c.enqueue(sse({ type: "vault", at }));
          listeners.add(send);
          c.enqueue(": hello\n\n");
          req.signal.addEventListener("abort", () => listeners.delete(send));
        },
        cancel() {
          listeners.delete(send);
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
    },

    "/api/models": async () => {
      try {
        return Response.json(await listModels());
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 502 });
      }
    },

    "/api/chat": {
      POST: async (req) => {
        const { message, sessionId, model, autoAllow, runId } = (await req.json()) as { message?: string; sessionId?: string; model?: string; autoAllow?: boolean | string; runId?: string };
        // true is what a page from before the "most" mode sends for Auto-allow on.
        const mode: AutoAllow = autoAllow === true || autoAllow === "all" ? "all" : autoAllow === "most" ? "most" : "off";
        if (!message?.trim()) return Response.json({ error: "empty message" }, { status: 400 });
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(c) {
            try {
              for await (const e of chat(message, vault, sessionId, model && model !== "default" ? model : undefined, mode, typeof runId === "string" && runId ? runId : undefined)) c.enqueue(enc.encode(sse(e)));
            } catch (e) {
              c.enqueue(enc.encode(sse({ type: "error", message: (e as Error).message })));
            }
            c.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
      },
    },

    // Multipart "file" fields are copied to the attachments folder; "obsidian" fields are vault links.
    "/api/attach": {
      POST: async (req) => {
        const form = await req.formData();
        const out: Attachment[] = [];
        try {
          for (const f of form.getAll("file")) if (typeof f !== "string") out.push(await saveAttachment(f));
          for (const uri of form.getAll("obsidian")) {
            const hit = await vaultFile(String(uri), vault, VAULT_NAME);
            if (!hit) return Response.json({ error: `not a note in ${VAULT_NAME}: ${uri}` }, { status: 404 });
            out.push(hit);
          }
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 413 });
        }
        return Response.json(out);
      },
    },

    "/api/water": {
      POST: async (req) => {
        const { name, note } = (await req.json()) as { name?: string; note?: string };
        const person = kinPeople(await kinState(vault)).find((p) => p.name === name?.normalize("NFC"));
        if (!person) return Response.json({ ok: false, error: `${name} is not on the kin map` }, { status: 404 });
        await waterPlant(vault, person, note ?? "");
        return Response.json({ ok: true });
      },
    },

    "/api/permission": {
      POST: async (req) => {
        const { id, allow, why } = (await req.json()) as { id: string; allow: boolean; why?: string };
        return Response.json({ ok: answerPermission(id, !!allow, typeof why === "string" ? why : "") });
      },
    },

    "/api/sessions": async () => Response.json(await sessions()),
    "/api/sessions/:id": {
      GET: async (req) => Response.json(await transcript(req.params.id)),
      DELETE: async (req) => {
        await forget(req.params.id);
        return Response.json({ ok: true });
      },
    },

    "/api/shutdown": {
      // Only from the Mac itself: from the phone there is no Hearth.app to light it again.
      POST: (req) => {
        if (!onThisMac(req)) return Response.json({ error: "stop the server from the Mac" }, { status: 403 });
        console.log("stopped from the page");
        setTimeout(() => process.exit(0), 200);
        return Response.json({ ok: true });
      },
    },

    "/api/stop": {
      POST: async (req) => {
        const { runId } = (await req.json().catch(() => ({}))) as { runId?: unknown };
        stop(typeof runId === "string" && runId ? runId : undefined);
        return Response.json({ ok: true });
      },
    },
  }),
  fetch: () => new Response("not found", { status: 404 }),
});

console.log(`hearth · vault ${vault}\n        http://127.0.0.1:${PORT}`);
if (!hasPassword) console.log(`        no password set (${AUTH_FILE}): run \`bun run password\` before sharing it beyond this Mac`);
