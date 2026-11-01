import { join } from "node:path";
import { watch } from "node:fs";
import { lastChange, type Vault } from "./vault";

// Vault change fan-out: one watcher per folder, debounced, broadcast to every listener.
// Cloud-synced folders do not always emit fs events, so a poll runs as a backstop.

export type VaultChanged = (at: number) => void;

export async function watchVault(vault: Vault, dirs: string[], { debounceMs = 400, pollMs = 5000 } = {}) {
  const listeners = new Set<VaultChanged>();
  const emit = () => listeners.forEach((l) => l(Date.now()));

  let debounce: Timer | null = null;
  for (const rel of dirs) {
    try {
      watch(join(vault.root, rel), () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(emit, debounceMs);
      });
    } catch (e) {
      console.warn(`not watching ${rel}: ${(e as Error).message}`);
    }
  }

  let seen = await lastChange(vault, dirs);
  setInterval(async () => {
    const now = await lastChange(vault, dirs);
    if (now > seen) {
      seen = now;
      emit();
    }
  }, pollMs);

  return {
    subscribe(l: VaultChanged) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
