import { PATHS } from "../vault/layout";
import type { Vault } from "../vault/vault";
import { threadSections, type Conversation } from "./thread";

/** Every person file in the conversations folder, named as the file is (NFC). */
export async function loadConversations(vault: Vault): Promise<Conversation[]> {
  const files = await vault.files(PATHS.conversations, /\.md$/);
  return Promise.all(
    files.map(async (f) => ({
      name: f.replace(/\.md$/, "").normalize("NFC"),
      threads: threadSections((await vault.text(`${PATHS.conversations}/${f}`)) ?? ""),
    })),
  );
}
