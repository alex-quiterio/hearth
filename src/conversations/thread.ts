import type { IsoDate } from "../shared/dates";

// A conversation file holds one person's threads: `## YYYY-MM-DD …` sections, each a message
// drafted by beeper:thread-reply and, in time, sent. A thread's state is its last recorded one.

export type ThreadState = "sent" | "draft" | "closed" | null;
export type Thread = { date: IsoDate; state: ThreadState; title: string };
/** One person's file of threads. */
export type Conversation = { name: string; threads: Thread[] };
export type Draft = { name: string; date: IsoDate; title: string };

// A state is an "Estado: **…**" line, or a send log line that opens in bold ("**Enviado.** Linha 1, 11h28").
const STATE = /^(?:(?:Estado|Status|State)[^:\n]*: \*\*([^*]+)\*\*|\*\*((?:Enviad|Sent|Não enviad|Not sent)[^*]*)\*\*)(.*)$/gim;
const NOT_SENT = /not sent|não enviad|por enviar|por escrever|rascunho|draft|unsent|partial|parcial/i;
// A send log line that still names lines to go is a thread half sent.
const STILL_TO_GO = /\bfalta|still to go|lines? \d.* to go|remain/i;
const CLOSED = /abandon|sem efeito|dropped|superseded|substitu/i;

/** The last recorded state of one thread section: "sent", "draft", "closed" (let go unsent), or null if none. */
export function threadState(section: string): ThreadState {
  const m = [...section.matchAll(STATE)].at(-1);
  if (!m) return null;
  const last = m[1] ?? m[2]!;
  if (CLOSED.test(last)) return "closed";
  if (NOT_SENT.test(last)) return "draft";
  if (m[2] && STILL_TO_GO.test(m[3]!)) return "draft";
  return /sent|enviad|todas|tudo/i.test(last) ? "sent" : "draft";
}

/** A person file split into its dated thread sections, each titled by its last `#### ` heading. */
export function threadSections(text: string): Thread[] {
  return text
    .split(/^## /m)
    .slice(1)
    .map((part) => ({
      date: part.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      state: threadState(part),
      title: [...part.matchAll(/^#### (.+)$/gm)].at(-1)?.[1]?.trim() ?? "",
    }))
    .filter((t): t is Thread => !!t.date);
}

/** Dates of the threads actually sent, oldest first. */
export const sentDates = (ts: Thread[]) => ts.filter((t) => t.state === "sent").map((t) => t.date).sort();

/** Threads still waiting to go out: drafts dated on or after the last sent thread, so a draft overtaken by a later send drops away. */
export function openDrafts(ts: Thread[]): Thread[] {
  const lastSent = sentDates(ts).at(-1) ?? "";
  return ts.filter((t) => t.state === "draft" && t.date >= lastSent);
}

/** "Beatriz (WhatsApp, 1:1), a morada do Ricardo" says only "a morada do Ricardo"; a bare "Name (WhatsApp, 1:1)" says nothing. */
const draftTitle = (title: string) => title.replace(/^[^(]*\([^)]*\)\s*,?\s*/, "");

export const draftsOf = (c: Conversation): Draft[] =>
  openDrafts(c.threads).map((t) => ({ name: c.name, date: t.date, title: draftTitle(t.title) }));

/** The date of the latest thread, sent or not. */
export const lastThread = (c: Conversation) => c.threads.map((t) => t.date).sort().at(-1) ?? null;

/** Every open draft dated on or after since, newest first. */
export const draftsSince = (cs: Conversation[], since: IsoDate) =>
  cs
    .flatMap(draftsOf)
    .filter((d) => d.date >= since)
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
