// A single password for the whole page. Its hash and the cookie-signing secret live outside the repo,
// in ~/.config/hearth/auth.json, written by `bun run password`. No file: no login (127.0.0.1 only, as before).
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, chmod } from "node:fs/promises";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const AUTH_FILE = process.env.HEARTH_AUTH_FILE ?? join(homedir(), ".config/hearth/auth.json");
const COOKIE = "hearth_session";
const DAYS = 365; // remembered for a year on each browser, through server restarts

type Auth = { hash: string; secret: string };
let auth: Auth | null = null;

export async function loadAuth(): Promise<boolean> {
  const f = Bun.file(AUTH_FILE);
  auth = (await f.exists()) ? ((await f.json()) as Auth) : null;
  return !!auth;
}

/** Hash a new password and rotate the secret, so every existing session is logged out. */
export async function setPassword(password: string) {
  const next: Auth = { hash: await Bun.password.hash(password), secret: randomBytes(32).toString("hex") };
  await mkdir(join(AUTH_FILE, ".."), { recursive: true });
  await Bun.write(AUTH_FILE, JSON.stringify(next, null, 2));
  await chmod(AUTH_FILE, 0o600);
}

const sign = (expires: string) => createHmac("sha256", auth!.secret).update(expires).digest("hex");

function cookieValue(req: Request) {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

export function authed(req: Request) {
  if (!auth) return true;
  const [expires, mac] = (cookieValue(req) ?? "").split(".");
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  const want = Buffer.from(sign(expires));
  const got = Buffer.from(mac);
  return got.length === want.length && timingSafeEqual(got, want);
}

const secure = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
// Lax, not Strict: opening Hearth from Hearth.app or a link must still carry the remembered login.
const cookie = (req: Request, value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? "; Secure" : ""}`;

// Slow down guessing: after 5 misses in a row, refuse for a minute.
let misses = 0;
let lockedUntil = 0;

export async function login(req: Request): Promise<Response> {
  if (!auth) return Response.redirect("/", 303);
  if (Date.now() < lockedUntil) return Response.redirect("/login?wait", 303);
  const form = await req.formData();
  const ok = await Bun.password.verify(String(form.get("password") ?? ""), auth.hash);
  if (!ok) {
    if (++misses >= 5) (lockedUntil = Date.now() + 60_000), (misses = 0);
    return Response.redirect("/login?wrong", 303);
  }
  misses = 0;
  const expires = String(Date.now() + DAYS * 86400_000);
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie(req, `${expires}.${sign(expires)}`, DAYS * 86400) } });
}

export const logout = (req: Request) => new Response(null, { status: 303, headers: { location: "/login", "set-cookie": cookie(req, "", 0) } });

export const authEnabled = () => !!auth;

// The server only listens on 127.0.0.1, so remote visits arrive through `tailscale serve`,
// which always adds X-Forwarded-For (a client can add to it, never strip it) and Tailscale-User-Login.
export const onThisMac = (req: Request) =>
  !req.headers.has("x-forwarded-for") && !req.headers.has("tailscale-user-login") && ["127.0.0.1", "localhost"].includes(new URL(req.url).hostname);
