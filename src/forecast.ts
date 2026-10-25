// The forecast: every dated thing the vault already holds, laid out over the days ahead.
// Birthdays from the kin map, watch and Now dates from Hearth.md, listen dates from emergent experiments,
// and the moon's turns. Read only, like the rest.

export type ForecastEvent = {
  kind: "birthday" | "watch" | "now" | "listen";
  /** A person on the kin map, when the event is theirs. */
  name: string | null;
  what: string;
  why: string;
  run: string | null;
};
export type ForecastDay = {
  date: string;
  weather: "clear" | "fair" | "cloudy" | "stormy";
  moon: "new moon" | "full moon" | null;
  events: ForecastEvent[];
};

type Input = {
  people: { name: string; nextBirthday: { date: string; in: number } | null }[];
  watch: { name: string; why?: string; until?: unknown }[];
  now: { what: string; why?: string; run?: string; until?: unknown }[];
  experiments: { name: string; listenOn: string | null }[];
};

export const FORECAST_DAYS = 14;
const CARRIED_WITHIN = 7; // days a passed date stays in "carried over" before it is left to Hearth.md

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);
/** A YAML date, which may arrive as a string or a Date. */
const dateOf = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = typeof v === "string" ? v.match(/^\d{4}-\d{2}-\d{2}/) : null;
  return m ? m[0] : null;
};

// Moon age in days since a known new moon (2000-01-06 18:14 UTC), synodic month 29.53 days.
// The mean moon, as on the Inner sky: a turn can land a day off the almanac's.
const SYNODIC = 29.530588;
const moonAge = (t: number) => (((t - Date.UTC(2000, 0, 6, 18, 14)) / DAY) % SYNODIC + SYNODIC) % SYNODIC;
/** The day the moon turns new or full: its phase crosses 0 or half a month between this midnight and the next. */
export function moonTurn(date: string): ForecastDay["moon"] {
  const a = moonAge(Date.parse(date)), b = moonAge(Date.parse(date) + DAY);
  if (b < a) return "new moon";
  if (a < SYNODIC / 2 && b >= SYNODIC / 2) return "full moon";
  return null;
}

const weatherOf = (n: number): ForecastDay["weather"] => (n === 0 ? "clear" : n === 1 ? "fair" : n === 2 ? "cloudy" : "stormy");

export function forecast(input: Input, today: string, days = FORECAST_DAYS) {
  const last = addDays(today, days - 1);
  const since = addDays(today, -CARRIED_WITHIN);
  const dated: { date: string; e: ForecastEvent }[] = [];

  for (const p of input.people)
    if (p.nextBirthday)
      dated.push({ date: p.nextBirthday.date, e: { kind: "birthday", name: p.name, what: `${p.name}'s birthday`, why: "", run: null } });
  const birthdayOn = new Set(dated.map((d) => `${d.e.name}|${d.date}`));

  for (const w of input.watch) {
    const date = dateOf(w.until);
    // A watch that ends on that person's birthday is the birthday; say it once.
    if (date && !birthdayOn.has(`${w.name}|${date}`))
      dated.push({ date, e: { kind: "watch", name: w.name, what: `${w.name}: watch ends`, why: w.why ?? "", run: null } });
  }
  for (const n of input.now) {
    const date = dateOf(n.until);
    if (date) dated.push({ date, e: { kind: "now", name: null, what: n.what, why: n.why ?? "", run: n.run ?? null } });
  }
  for (const x of input.experiments)
    if (x.listenOn)
      dated.push({
        date: x.listenOn,
        e: { kind: "listen", name: null, what: `Listen back: ${x.name.replace(/^Emergent /, "")}`, why: "", run: `/thinking:emergent listen back on ${x.name}` },
      });

  const out: ForecastDay[] = Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const events = dated.filter((d) => d.date === date).map((d) => d.e);
    return { date, weather: weatherOf(events.length), moon: moonTurn(date), events };
  });
  const carried = dated
    .filter((d) => d.date < today && d.date >= since && d.e.kind !== "birthday")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d.e, date: d.date }));
  return { today, last, days: out, carried };
}

export type Forecast = ReturnType<typeof forecast>;
