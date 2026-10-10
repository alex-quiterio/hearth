import { join } from "node:path";
import { watch } from "node:fs";
import { findVault, state, lastChange, kinState, kinPeople, PATHS, VAULT_NAME } from "./vault";
import { waterPlant } from "./garden";
import { chat, answerPermission, stop, listModels } from "./agent";
import { sessions, transcript, forget } from "./history";
import { saveAttachment, vaultFile, sweepAttachments, type Attachment } from "./attach";
import { loadAuth, authed, login, logout, AUTH_FILE } from "./auth";

const vault = await findVault();
const PORT = Number(process.env.HEARTH_PORT ?? 4747);
const PUBLIC = join(import.meta.dir, "../public");

// Vault change fan-out: one watcher per folder, debounced, broadcast to every open tab.
const listeners = new Set<(at: number) => void>();
let debounce: Timer | null = null;
for (const rel of [PATHS.kinDir, PATHS.conversations]) {
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
const OPEN = new Set(["/login", "/style.css", "/favicon.svg", "/favicon.ico"]);
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
      GET: (req) => (authed(req) ? Response.redirect("/", 303) : new Response(Bun.file(join(PUBLIC, "login.html")))),
      POST: login,
    },
    "/logout": { POST: logout },

    "/": () => new Response(Bun.file(join(PUBLIC, "index.html"))),
    "/app.js": () => new Response(Bun.file(join(PUBLIC, "app.js"))),
    "/ember.js": () => new Response(Bun.file(join(PUBLIC, "ember.js"))),
    "/style.css": () => new Response(Bun.file(join(PUBLIC, "style.css"))),
    "/favicon.svg": () => new Response(Bun.file(join(PUBLIC, "favicon.svg"))),
    "/favicon.ico": () => new Response(Bun.file(join(PUBLIC, "favicon.svg")), { headers: { "content-type": "image/svg+xml" } }),

    "/api/state": async () => Response.json({ ...(await state(vault)), auth: hasPassword }),

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
        const { message, sessionId, model } = (await req.json()) as { message?: string; sessionId?: string; model?: string };
        if (!message?.trim()) return Response.json({ error: "empty message" }, { status: 400 });
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(c) {
            try {
              for await (const e of chat(message, vault, sessionId, model && model !== "default" ? model : undefined)) c.enqueue(enc.encode(sse(e)));
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
        const { id, allow } = (await req.json()) as { id: string; allow: boolean };
        return Response.json({ ok: answerPermission(id, !!allow) });
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
      POST: () => {
        console.log("stopped from the page");
        setTimeout(() => process.exit(0), 200);
        return Response.json({ ok: true });
      },
    },

    "/api/stop": {
      POST: () => {
        stop();
        return Response.json({ ok: true });
      },
    },
  }),
  fetch: () => new Response("not found", { status: 404 }),
});

console.log(`hearth · vault ${vault}\n        http://127.0.0.1:${PORT}`);
if (!hasPassword) console.log(`        no password set (${AUTH_FILE}): run \`bun run password\` before sharing it beyond this Mac`);
