import { join } from "node:path";
import { config } from "../config";
import type { WritableVault } from "../vault/vault";
import { dashboard, kinIdentities } from "../app/dashboard";
import { tend } from "../app/tend";
import { chat, listModels, stop } from "../chat/session";
import { answerPermission } from "../chat/permission-bridge";
import { autoAllowOf } from "../chat/permission-policy";
import { sessions, transcript, forget } from "../chat/history";
import { saveAttachment, vaultFile, type Attachment } from "../attachments/attachments";
import { authed, login, logout, onThisMac } from "../access/auth";
import { menu } from "../skills/catalog";
import { beeperOn, talk, shifts, unread, rhythms } from "../talk/talk-service";
import type { VaultChanged } from "../vault/watcher";

// The HTTP interface: thin adapters from requests to the application services. No domain logic here.

const PUBLIC = join(import.meta.dir, "../../public");

// The app version: the checkout's commit, read on every page load so a refresh shows the latest.
// A trailing + means uncommitted changes. The page is read fresh each time too; `bun run dev` restarts the server when src/ changes.
const version = () =>
  Bun.spawnSync(["git", "describe", "--always", "--abbrev=5", "--dirty=+"], { cwd: import.meta.dir }).stdout.toString().trim() || "?";
const page = async (name: string) =>
  new Response((await Bun.file(join(PUBLIC, name)).text()).replace("<!--SHA-->", version()), { headers: { "content-type": "text/html; charset=utf-8" } });
const asset = (name: string, init?: ResponseInit) => () => new Response(Bun.file(join(PUBLIC, name)), init);

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
const sseHeaders = { "content-type": "text/event-stream", "cache-control": "no-cache" };
/** A Beeper read: 404 when Beeper is off here, 503 when its index could not be read. */
const beeper = async (read: () => object | Promise<object>) => {
  if (!beeperOn()) return Response.json({ error: "Beeper is off on this machine" }, { status: 404 });
  const r = await read();
  return Response.json(r, { status: "error" in r ? 503 : 200 });
};
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export type RouteDeps = {
  vault: WritableVault;
  hasPassword: boolean;
  onVaultChange: (l: VaultChanged) => () => void;
};

export function routes({ vault, hasPassword, onVaultChange }: RouteDeps) {
  return guardAll({
    "/login": {
      GET: (req) => (authed(req) ? Response.redirect("/", 303) : page("login.html")),
      POST: login,
    },
    "/logout": { POST: logout },

    "/": () => page("index.html"),
    "/app.js": asset("app.js"),
    "/ember.js": asset("ember.js"),
    "/style.css": asset("style.css"),
    "/favicon.svg": asset("favicon.svg"),
    "/favicon.ico": asset("favicon.svg", { headers: { "content-type": "image/svg+xml" } }),
    ...Object.fromEntries(APP_FILES.map((f) => [`/${f}`, asset(f, APP_HEADERS[f])])),

    "/api/state": async (req) =>
      Response.json({ ...(await dashboard(vault)), auth: hasPassword, lockAfter: config.server.lockAfter, local: onThisMac(req), beeper: beeperOn() }),
    "/api/menu": async () => Response.json(await menu()),

    "/api/talk": (req) => beeper(() => talk(Math.min(3650, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 90)))),
    // Who is warming, cooling, gone quiet or waiting on a reply, matched against the kin map.
    "/api/shifts": () => beeper(async () => shifts(await kinIdentities(vault))),
    // When each kin person writes and how fast each side answers, from timestamps only.
    "/api/rhythms": () => beeper(async () => rhythms(await kinIdentities(vault))),
    // Direct chats with unread messages, and the newest unread lines in each.
    "/api/unread": () => beeper(async () => unread(await kinIdentities(vault))),

    "/api/events": (req) => {
      let off = () => {};
      const stream = new ReadableStream({
        start(c) {
          off = onVaultChange((at) => c.enqueue(sse({ type: "vault", at })));
          c.enqueue(": hello\n\n");
          req.signal.addEventListener("abort", () => off());
        },
        cancel() {
          off();
        },
      });
      return new Response(stream, { headers: sseHeaders });
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
        const { message, sessionId, model, autoAllow, runId } = (await req.json()) as Record<string, unknown>;
        if (typeof message !== "string" || !message.trim()) return Response.json({ error: "empty message" }, { status: 400 });
        const turn = {
          message,
          vault: vault.root,
          sessionId: text(sessionId),
          model: model && model !== "default" ? text(model) : undefined,
          autoAllow: autoAllowOf(autoAllow),
          runId: text(runId),
        };
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(c) {
            try {
              for await (const e of chat(turn)) c.enqueue(enc.encode(sse(e)));
            } catch (e) {
              c.enqueue(enc.encode(sse({ type: "error", message: (e as Error).message })));
            }
            c.close();
          },
        });
        return new Response(stream, { headers: sseHeaders });
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
            const hit = await vaultFile(String(uri), vault.root, config.vault.name);
            if (!hit) return Response.json({ error: `not a note in ${config.vault.name}: ${uri}` }, { status: 404 });
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
        if (!(await tend(vault, name ?? "", note ?? ""))) return Response.json({ ok: false, error: `${name} is not on the kin map` }, { status: 404 });
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
        stop(text(runId));
        return Response.json({ ok: true });
      },
    },
  });
}
