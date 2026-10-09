import { describe, expect, test } from "bun:test";
import { join, resolve, dirname } from "node:path";
import { mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";

process.env.HEARTH_ATTACH_DIR = await mkdtemp(join(tmpdir(), "hearth-attach-test-"));
const { saveAttachment, vaultFile, sweepAttachments, ATTACH_DIR } = await import("../src/attach");

const vault = resolve("test/fixtures/vault");
const link = (file: string, v = "pandora") => `obsidian://open?vault=${v}&file=${encodeURIComponent(file)}`;

describe("attachments", () => {
  test("a dropped file is copied out of the repo, with a safe name", async () => {
    const a = await saveAttachment(new File(["hi"], "../../a b?.txt"));
    expect(dirname(a.path)).toBe(ATTACH_DIR);
    expect(a.path.endsWith("-a b_.txt")).toBe(true);
    expect(await Bun.file(a.path).text()).toBe("hi");
  });

  test("an Obsidian link resolves to the note in the vault", async () => {
    const a = await vaultFile(link("4 - Archive/kin/Kin map"), vault, "pandora");
    expect(a?.path).toBe(join(vault, "4 - Archive/kin/Kin map.md"));
  });

  test("links outside the vault, to another vault or to nothing are refused", async () => {
    expect(await vaultFile(link("../../package.json"), vault, "pandora")).toBeNull();
    expect(await vaultFile(link("4 - Archive/kin/Kin map", "other"), vault, "pandora")).toBeNull();
    expect(await vaultFile(link("nope"), vault, "pandora")).toBeNull();
    expect(await vaultFile("https://example.com", vault, "pandora")).toBeNull();
  });

  test("old copies are swept, fresh ones kept", async () => {
    const old = await saveAttachment(new File(["x"], "old.txt"));
    const fresh = await saveAttachment(new File(["y"], "fresh.txt"));
    const twoDaysAgo = new Date(Date.now() - 2 * 864e5);
    await utimes(old.path, twoDaysAgo, twoDaysAgo);
    await sweepAttachments();
    expect(await Bun.file(old.path).exists()).toBe(false);
    expect(await Bun.file(fresh.path).exists()).toBe(true);
  });
});
