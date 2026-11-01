import { PATHS } from "../vault/layout";
import type { Vault } from "../vault/vault";
import { byListenDate, EXPERIMENT_FILE, listenOn, type Experiment } from "./practice";
import { PROJECT_OUTPUT, ROUGH_OUTPUT, type Output } from "./outputs";

const OUTPUT_PLACES: [dir: string, file: RegExp][] = [
  [PATHS.roughNotes, ROUGH_OUTPUT],
  [PATHS.projectsDir, PROJECT_OUTPUT],
];

export async function loadExperiments(vault: Vault): Promise<Experiment[]> {
  const dir = PATHS.roughNotes;
  const files = await vault.files(dir, EXPERIMENT_FILE);
  return byListenDate(
    await Promise.all(
      files.map(async (f) => ({
        name: f.replace(/\.md$/, ""),
        listenOn: listenOn((await vault.text(`${dir}/${f}`)) ?? ""),
        mtime: await vault.mtime(`${dir}/${f}`),
      })),
    ),
  );
}

export async function loadOutputs(vault: Vault): Promise<Output[]> {
  const out: Output[] = [];
  for (const [dir, re] of OUTPUT_PLACES)
    for (const f of await vault.files(dir, re))
      out.push({ name: f.replace(/\.md$/, ""), kind: f.match(re)![1]!, mtime: await vault.mtime(`${dir}/${f}`) });
  return out;
}
