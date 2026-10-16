import { test, expect } from "bun:test";
import { onThisMac } from "../src/auth";

test("a visit from the Mac itself is local", () => {
  expect(onThisMac(new Request("http://127.0.0.1:4747/api/state"))).toBe(true);
  expect(onThisMac(new Request("http://localhost:4747/api/state"))).toBe(true);
});

test("a visit through tailscale serve is not", () => {
  const forwarded = new Request("http://127.0.0.1:4747/api/shutdown", { headers: { "x-forwarded-for": "100.64.0.7" } });
  const tailnet = new Request("http://127.0.0.1:4747/api/shutdown", { headers: { "tailscale-user-login": "alex@example.com" } });
  expect(onThisMac(forwarded)).toBe(false);
  expect(onThisMac(tailnet)).toBe(false);
  expect(onThisMac(new Request("https://mac.tailnet.ts.net/api/shutdown"))).toBe(false);
});
