// End-to-end check against a running server: state loads, and one cheap chat turn
// (no tools) streams back. Usage: bun run smoke [port]
const base = `http://127.0.0.1:${process.argv[2] ?? process.env.HEARTH_PORT ?? 4747}`;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => (console.error(`  ✗ ${m}`), process.exit(1));

const page = await fetch(base).catch(() => fail(`nothing on ${base}; run \`bun start\` first`));
if (!page || !(await page.text()).includes("<html")) fail("page did not load");
ok("page loads");

const s: any = await (await fetch(`${base}/api/state`)).json();
if (!s.kin.exists) fail("no Kin map found in the vault");
const people = s.kin.rings.reduce((n: number, r: any) => n + r.people.length, 0);
ok(`kin map: ${s.kin.rings.length} rings, ${people} people`);
ok(s.config.exists ? `Hearth.md: ${s.config.pinned.length} pinned, ${s.config.watch.length} watched, ${s.config.actions.length} actions` : "no Hearth.md yet (defaults)");

console.log("  … one chat turn (about $0.20 of usage)");
const r = await fetch(`${base}/api/chat`, {
  method: "POST",
  body: JSON.stringify({ message: "Reply with exactly: hearth ok. Use no tools." }),
});
const reader = r.body!.getReader();
const dec = new TextDecoder();
let buf = "", text = "", session = "", done: any = null;
while (true) {
  const { value, done: end } = await reader.read();
  if (end) break;
  buf += dec.decode(value);
  let i;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const e = JSON.parse(buf.slice(0, i).replace(/^data: /, ""));
    buf = buf.slice(i + 2);
    if (e.type === "session") session = e.sessionId;
    if (e.type === "text") text += e.delta;
    if (e.type === "done") done = e;
    if (e.type === "error") fail(e.message);
  }
}
if (!session) fail("no session started");
if (!done || done.isError) fail("turn did not finish cleanly");
ok(`chat: "${text.trim()}" ($${done.costUsd.toFixed(2)})`);
