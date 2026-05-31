/**
 * Friendly session codenames — `<adjective>-<noun>-<suffix>` (e.g.
 * `wondrous-wadler-3f2a`), in the spirit of Docker/Heroku/branch codenames.
 * Used as the session id (which is an opaque key, never sorted on), so fresh
 * sessions read as a fun name instead of a timestamp until the agent generates
 * a real title.
 */

const ADJECTIVES = [
  "wondrous", "hardcore", "confident", "tender", "youthful", "eager", "loving",
  "jolly", "zany", "peppy", "witty", "cosmic", "funky", "breezy", "snazzy",
  "plucky", "quirky", "dapper", "mellow", "nimble", "cheeky", "bouncy", "groovy",
  "swift", "sleepy", "brave", "clever", "gentle", "fuzzy", "spunky", "gleeful",
  "merry", "sassy", "frisky", "lucky", "giddy", "bubbly", "cuddly", "daring",
  "epic", "feisty", "goofy", "hyper", "jazzy", "keen", "lively", "noble",
  "proud", "rapid", "silly", "turbo", "upbeat", "vivid", "wily", "zesty",
  "amber", "scarlet", "stoic", "lunar", "solar",
];

const NOUNS = [
  "wadler", "cohen", "galileo", "pare", "austin", "turing", "hopper", "lovelace",
  "curie", "tesla", "newton", "darwin", "bohr", "hawking", "feynman", "noether",
  "euler", "gauss", "fermat", "pascal", "kepler", "mendel", "faraday", "maxwell",
  "planck", "dirac", "heisenberg", "archimedes", "hypatia", "lamarr", "franklin",
  "goodall", "sagan", "dyson", "knuth", "ritchie", "torvalds", "ramanujan",
  "narwhal", "platypus", "axolotl", "pangolin", "quokka", "capybara", "wombat",
  "lemur", "meerkat", "otter", "puffin", "walrus", "badger", "ferret", "gibbon",
  "marmot", "possum", "tapir", "mantis", "gecko", "lynx", "heron",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** A fresh `<adjective>-<noun>-<4char>` codename. The suffix keeps it unique. */
export function randomSessionName(): string {
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${suffix}`;
}
