// Set or change the Hearth password: bun run password. Changing it logs out every browser.
import { setPassword, AUTH_FILE } from "../src/auth";

// Read without echoing what is typed. One reader for both questions: a second for-await on stdin gets nothing.
const tty = process.stdin.isTTY;
if (tty) process.stdin.setRawMode(true);
const input = process.stdin[Symbol.asyncIterator]();
let pending = "";
async function ask(label: string) {
  process.stdout.write(label);
  let out = "";
  while (true) {
    if (!pending) {
      const { value, done } = await input.next();
      if (done) return out;
      pending = value.toString();
    }
    const c = pending[0]!;
    pending = pending.slice(1);
    if (c === "\r" || c === "\n") { process.stdout.write("\n"); return out; }
    if (c === "\u0003") process.exit(130);
    if (c === "\u007f") out = out.slice(0, -1);
    else out += c;
  }
}

const pw = await ask("New Hearth password: ");
if (pw.length < 8) (console.error("Use at least 8 characters."), process.exit(1));
if ((await ask("Again: ")) !== pw) (console.error("They do not match."), process.exit(1));
if (tty) process.stdin.setRawMode(false);
await setPassword(pw);
console.log(`Saved to ${AUTH_FILE}. Restart Hearth to use it.`);
process.exit(0);
