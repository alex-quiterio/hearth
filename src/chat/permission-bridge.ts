import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// Allow/Deny cards waiting on Alex: a tool call held until the page answers it.

const pending = new Map<string, (r: PermissionResult) => void>();

/** Holds a call until it is answered, or denied when its turn is aborted. */
export function ask(id: string, signal: AbortSignal): Promise<PermissionResult> {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    signal.addEventListener("abort", () => answerPermission(id, false));
  });
}

/** why: the optional reason typed on the Deny card, passed on so the next step can take it into account. */
export function answerPermission(id: string, allow: boolean, why = ""): boolean {
  const resolve = pending.get(id);
  if (!resolve) return false;
  pending.delete(id);
  const reason = why.trim().slice(0, 500);
  resolve(allow ? { behavior: "allow" } : { behavior: "deny", message: reason ? `Alex declined this in Hearth. Why: ${reason}` : "Alex declined this in Hearth." });
  return true;
}
