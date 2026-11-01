import { config } from "../config";
import { addDays, today as todayIs, type IsoDate } from "../shared/dates";
import { md } from "../shared/markdown";
import { PATHS, noteName } from "../vault/layout";
import type { Vault } from "../vault/vault";
import { everyone, woes } from "../kin/kin-map";
import { identity, type KinIdentity, type Person } from "../kin/person";
import { loadKinMap } from "../kin/kin-map-repository";
import { draftsSince, lastThread, draftsOf, type Conversation, type Draft } from "../conversations/thread";
import { loadConversations } from "../conversations/conversations-repository";
import { loadTendingBlocks } from "../tending/tending-repository";
import { growGarden, type Attention, type Chat } from "../garden/garden";
import { excerpt, PSYCHOLOGY_SECTIONS, TERRITORY_SECTIONS } from "../inner/psyche";
import { moments, newestFirst, weekly } from "../inner/proprioception";
import { datedPractices, practiceDays, practiceEntries, practicesHeld, spellbook } from "../inner/practice";
import { gatherEmbers } from "../inner/embers";
import { latestOutputs } from "../inner/outputs";
import { loadExperiments, loadOutputs } from "../inner/inner-repository";
import { loadHearthConfig } from "../hearth/hearth-repository";
import { forecast } from "../forecast/forecast";
import { beeperOn, shifts } from "../talk/talk-service";
import { configView, emberView, excerptView, gardenView, kinView, tendingView } from "./views";

// Query service: the whole dashboard read model, assembled from every context. Each note is read once.

const DRAFTS_WITHIN = 30; // days; older unsent drafts are left to the person's sheet

/** A kin map person, with what their conversation file says. */
export type KinPerson = Person & { lastThread: IsoDate | null; draftsWaiting: number };

const withConversation = (cs: Conversation[]) => {
  const byFile = new Map(cs.map((c) => [c.name, c]));
  return (p: Person): KinPerson => {
    const c = byFile.get(p.name);
    return { ...p, lastThread: c ? lastThread(c) : null, draftsWaiting: c ? draftsOf(c).length : 0 };
  };
};

/** Who wrote last on Beeper, for the reply clock: timestamps only, kin map people only. */
export function beeperChats(kin: KinIdentity[]): Chat[] {
  if (!beeperOn()) return [];
  const sh = shifts(kin);
  return "error" in sh ? [] : sh.all.filter((c) => c.kin);
}

/** The kin map's people, as the chat networks know them. */
export const kinIdentities = async (vault: Vault) => everyone(await loadKinMap(vault)).map(identity);

/** A kin map person by name, or undefined. */
export const findPerson = async (vault: Vault, name: string) =>
  everyone(await loadKinMap(vault)).find((p) => p.name === name.normalize("NFC"));

/** Every draft still waiting to go out, newest first, from the last month. */
export const draftsWaiting = async (vault: Vault, today = todayIs()): Promise<Draft[]> =>
  draftsSince(await loadConversations(vault), addDays(today, -DRAFTS_WITHIN));

/** The garden alone, rendered, for a given set of people and chats. */
export async function gardenFor<P extends Person>(vault: Vault, people: P[], attention: Attention, today = todayIs(), chats: Chat[] = [], now = Date.now()) {
  const [tending, conversations] = await Promise.all([loadTendingBlocks(vault), loadConversations(vault)]);
  return gardenView(growGarden({ people, tending, conversations, chats, attention, today, now }));
}

export async function dashboard(vault: Vault, today = todayIs(), chatsFor: (kin: KinIdentity[]) => Chat[] = beeperChats) {
  const [hearth, map, conversations, tendingNote, tending, psychology, territory, practiceLog, spells, proprioception, coordination, experiments, outputs] =
    await Promise.all([
      loadHearthConfig(vault),
      loadKinMap(vault),
      loadConversations(vault),
      vault.note(PATHS.tendingLog),
      loadTendingBlocks(vault),
      vault.note(PATHS.psychology),
      vault.note(PATHS.territory),
      vault.note(PATHS.practiceLog),
      vault.note(PATHS.spells),
      vault.note(PATHS.proprioception),
      vault.note(PATHS.coordination),
      loadExperiments(vault),
      loadOutputs(vault),
    ]);

  const kin = kinView(map, withConversation(conversations));
  const people = kin.exists ? kin.rings.flatMap((r) => r.people) : [];
  const garden = growGarden({ people, tending, conversations, chats: chatsFor(people.map(identity)), attention: hearth, today, now: Date.now() });

  const entries = practiceEntries(practiceLog);
  const book = spellbook(spells);
  const thinking = {
    exists: !!practiceLog || !!spells || experiments.length > 0,
    practices: md(practicesHeld(practiceLog)),
    recent: md(entries.slice(0, 3).map((e) => e.trim()).join("\n")),
    spells: book.map((s) => s.name),
    experiments,
    days: practiceDays(entries),
    woes: woes(people),
  };

  const allMoments = moments(proprioception);
  const latestMoments = newestFirst(allMoments);
  const partner = coordination && excerpt(coordination, [/./]);
  const innerScreen = {
    proprioception: proprioception
      ? {
          weekly: md(weekly(proprioception)),
          moments: latestMoments.slice(0, 3).map(({ body, ...m }) => ({ ...m, html: md(body) })),
          count: latestMoments.length,
          days: [...new Set(latestMoments.map((m) => m.date))],
        }
      : null,
    coordination: partner && partner.sections.length ? excerptView(partner) : null,
    notes: latestOutputs(outputs),
  };

  const embers = gatherEmbers({
    moments: allMoments,
    practices: datedPractices(practiceLog),
    spells: book,
    tending,
    notes: { moment: noteName(PATHS.proprioception), practice: noteName(PATHS.practiceLog), spell: noteName(PATHS.spells), tending: noteName(PATHS.tendingLog) },
  }).map(emberView);

  return {
    vaultName: config.vault.name,
    config: configView(hearth),
    kin,
    inner: {
      psychology: excerptView(psychology && excerpt(psychology, PSYCHOLOGY_SECTIONS)),
      territory: excerptView(territory && excerpt(territory, TERRITORY_SECTIONS)),
    },
    tending: tendingView(tendingNote),
    thinking,
    innerScreen,
    embers,
    drafts: draftsSince(conversations, addDays(today, -DRAFTS_WITHIN)),
    garden: gardenView(garden),
    forecast: forecast({ people: garden.plants, watch: hearth.watch, now: hearth.now, experiments }, garden.today),
    at: Date.now(),
  };
}

export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
