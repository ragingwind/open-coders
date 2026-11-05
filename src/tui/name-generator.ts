import { PROFILE_NAME_PATTERN } from "../config/schema";

const ADJECTIVES = [
  "amber",
  "breezy",
  "bright",
  "calm",
  "clever",
  "cosmic",
  "curious",
  "dapper",
  "delightful",
  "eager",
  "elegant",
  "fancy",
  "fuzzy",
  "gentle",
  "glossy",
  "golden",
  "happy",
  "humble",
  "jolly",
  "keen",
  "lively",
  "lucky",
  "magical",
  "mellow",
  "nimble",
  "quirky",
  "radiant",
  "silent",
  "sunny",
  "swift",
  "tender",
  "vivid",
  "witty",
  "zany",
] as const;

const NOUNS = [
  "badger",
  "comet",
  "crane",
  "falcon",
  "fern",
  "fox",
  "harbor",
  "heron",
  "juniper",
  "koala",
  "lantern",
  "lynx",
  "meadow",
  "moose",
  "otter",
  "panda",
  "pine",
  "raven",
  "river",
  "sparrow",
  "summit",
  "tide",
  "tiger",
  "willow",
  "wolf",
  "wreath",
  "wren",
  "yarrow",
] as const;

export interface NameSuggestion {
  name: string;
  basis: string;
}

export interface NameOptions {
  existing?: Iterable<string>;
  random?: () => number;
}

export function generateProfileName(options: NameOptions = {}): NameSuggestion {
  const existing = new Set(options.existing ?? []);
  const random = options.random ?? Math.random;

  for (let attempt = 0; attempt < 50; attempt++) {
    const adjective = pick(ADJECTIVES, random);
    const noun = pick(NOUNS, random);
    const candidate = `${adjective}-${noun}`;
    if (!existing.has(candidate) && PROFILE_NAME_PATTERN.test(candidate)) {
      return { name: candidate, basis: "random codename" };
    }
  }

  return {
    name: uniqueName(`${ADJECTIVES[0]}-${NOUNS[0]}`, existing),
    basis: "random codename + numeric suffix",
  };
}

function pick<T>(values: readonly T[], random: () => number): T {
  const index = Math.floor(random() * values.length);
  const value = values[Math.min(Math.max(index, 0), values.length - 1)];
  if (value === undefined) throw new Error("cannot pick from an empty list");
  return value;
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
