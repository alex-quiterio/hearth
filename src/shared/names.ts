// How a person's name is compared across the vault, the tending log and Beeper.

/** Same person in the vault: NFC (files may be stored decomposed), case and outer spaces ignored. */
export const sameName = (s: string) => s.normalize("NFC").toLowerCase().trim();

/** Same person across chat networks: accents, punctuation and spacing ignored too. */
export const nameKey = (name: string) =>
  name.normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().toLowerCase() || name;

/** A list indexed by sameName. */
export const byName = <T extends { name: string }>(list: T[]) => new Map(list.map((x) => [sameName(x.name), x]));
