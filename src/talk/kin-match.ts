import { nameKey } from "../shared/names";
import type { KinIdentity } from "../kin/person";

// Beeper knows people by the name each network shows; the kin map by the name Alex gives them.
// One person on several networks (a mother on Signal and on WhatsApp) is one person.

/** The kin map person for a Beeper name: the same name or an alias, every word of the map name, or a first name only one Beeper person has. */
export function kinMatch(names: string[], kin: KinIdentity[]) {
  const words = (s: string) => nameKey(s).split(" ").filter(Boolean);
  const firsts = new Map<string, number>();
  for (const n of names) firsts.set(words(n)[0] ?? "", (firsts.get(words(n)[0] ?? "") ?? 0) + 1);
  return (name: string): KinIdentity | null => {
    const w = words(name);
    return (
      kin.find((k) => nameKey(k.name) === nameKey(name) || k.aka?.some((a) => nameKey(a) === nameKey(name))) ??
      kin.find((k) => words(k.name).length > 1 && words(k.name).every((x) => w.includes(x))) ??
      kin.find((k) => words(k.name).length === 1 && words(k.name)[0] === w[0] && firsts.get(w[0]!) === 1) ??
      null
    );
  };
}

const NETWORK: Record<string, string> = { instagramgo: "instagram" };

/** The network a Beeper account is on, by its usual name. */
export const networkOf = (account: string) => {
  const net = account.split(".")[0]!;
  return NETWORK[net] ?? net;
};

export const addNet = (nets: string[], net: string) => {
  if (!nets.includes(net)) nets.push(net);
};
