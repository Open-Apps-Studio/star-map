/**
 * Local search index. The engine only resolves exact designations
 * ("NAME Saturn", "HIP 32349", "M 31"); stellarium-web.org's fuzzy search uses
 * a private API, so we ship our own list of the things people actually look for.
 */
import { starByHip, type Stel, type SweObj } from "./engine";

export type Kind = "planet" | "star" | "constellation" | "deep-sky" | "satellite";

export interface Entry {
  name: string;
  /** Extra words that should also match ("evening star", "Big Dipper"…). */
  aliases?: string[];
  kind: Kind;
  /** Engine designations to try, first match wins. */
  ids: string[];
  blurb?: string;
}

const PLANETS: Entry[] = [
  { name: "Moon", kind: "planet", ids: ["NAME Moon"], blurb: "Earth's only natural satellite." },
  { name: "Sun", kind: "planet", ids: ["NAME Sun"], blurb: "Never look at it directly." },
  { name: "Mercury", kind: "planet", ids: ["NAME Mercury"], blurb: "Smallest planet, always close to the Sun." },
  { name: "Venus", kind: "planet", ids: ["NAME Venus"], aliases: ["evening star", "morning star"], blurb: "Brightest planet. Often the first 'star' after sunset." },
  { name: "Mars", kind: "planet", ids: ["NAME Mars"], aliases: ["red planet"], blurb: "The red planet." },
  { name: "Jupiter", kind: "planet", ids: ["NAME Jupiter"], blurb: "Largest planet. Binoculars show its four big moons." },
  { name: "Saturn", kind: "planet", ids: ["NAME Saturn"], blurb: "Any small telescope shows the rings." },
  { name: "Uranus", kind: "planet", ids: ["NAME Uranus"], blurb: "Barely visible to the naked eye under dark skies." },
  { name: "Neptune", kind: "planet", ids: ["NAME Neptune"], blurb: "Needs binoculars or a telescope." },
  { name: "International Space Station", kind: "satellite", ids: ["NAME ISS (ZARYA)", "NAME ISS", "NORAD 25544"], aliases: ["iss"], blurb: "Crewed station, crossing the sky in a few minutes." },
];

/** [name, Hipparcos number, aliases, blurb] for the best-known named stars. */
const STARS: [string, number, string[]?, string?][] = [
  ["Sirius", 32349, ["dog star"], "Brightest star in the night sky."],
  ["Canopus", 30438, [], "Second-brightest star, low in the south."],
  ["Arcturus", 69673, [], "Orange giant; follow the arc of the Big Dipper's handle."],
  ["Rigil Kentaurus", 71683, ["alpha centauri"], "Nearest star system visible to the eye."],
  ["Vega", 91262, [], "Corner of the Summer Triangle."],
  ["Capella", 24608, [], "Bright yellow star in Auriga."],
  ["Rigel", 24436, [], "Orion's blue-white foot."],
  ["Procyon", 37279, [], "Little Dog's bright star."],
  ["Achernar", 7588, [], "End of the river Eridanus."],
  ["Betelgeuse", 27989, [], "Orion's red shoulder, a supergiant."],
  ["Hadar", 68702, [], ""],
  ["Altair", 97649, [], "Corner of the Summer Triangle."],
  ["Acrux", 60718, ["southern cross"], "Brightest star of the Southern Cross."],
  ["Aldebaran", 21421, ["bull's eye"], "The bull's red eye."],
  ["Antares", 80763, [], "Red heart of the Scorpion."],
  ["Spica", 65474, [], "Brightest star in Virgo."],
  ["Pollux", 37826, [], "The brighter Gemini twin."],
  ["Castor", 36850, [], "The other Gemini twin, a six-star system."],
  ["Fomalhaut", 113368, [], "Lonely bright star of autumn."],
  ["Deneb", 102098, [], "Tail of the Swan, Summer Triangle corner."],
  ["Regulus", 49669, [], "Heart of the Lion."],
  ["Bellatrix", 25336, [], "Orion's other shoulder."],
  ["Alnilam", 26311, ["orion's belt"], "Middle star of Orion's Belt."],
  ["Alnitak", 26727, ["orion's belt"], "Belt star next to the Horsehead Nebula."],
  ["Mintaka", 25930, ["orion's belt"], "Belt star that sits on the celestial equator."],
  ["Polaris", 11767, ["north star", "pole star"], "Stays put while the whole sky turns around it."],
  ["Dubhe", 54061, ["big dipper"], "Pointer star: follow it to Polaris."],
  ["Merak", 53910, ["big dipper"], "The other pointer star."],
  ["Alioth", 62956, ["big dipper"], ""],
  ["Mizar", 65378, ["big dipper"], "Look closely: it has a faint companion, Alcor."],
  ["Alkaid", 67301, ["big dipper"], "End of the Dipper's handle."],
  ["Mirfak", 15863, [], "Brightest star in Perseus."],
  ["Algol", 14576, ["demon star"], "Dims every 2.9 days as its partner eclipses it."],
  ["Albireo", 95947, [], "Gold and blue double star in a small telescope."],
  ["Alphard", 46390, [], "The lonely one in Hydra."],
  ["Hamal", 9884, [], "Brightest star in Aries."],
  ["Denebola", 57632, [], "The Lion's tail."],
  ["Alpheratz", 677, [], "Corner of the Great Square of Pegasus."],
  ["Mirach", 5447, [], "Star-hop from here to the Andromeda Galaxy."],
  ["Rasalhague", 86032, [], "Head of Ophiuchus."],
  ["Kochab", 72607, ["little dipper"], ""],
  ["Shaula", 85927, [], "The Scorpion's stinger."],
  ["Saiph", 27366, [], "Orion's knee."],
  ["Elnath", 25428, [], ""],
  ["Alhena", 31681, [], ""],
  ["Mimosa", 62434, ["southern cross"], ""],
  ["Gacrux", 61084, ["southern cross"], ""],
  ["Kaus Australis", 90185, ["teapot"], "Brightest star of the Sagittarius Teapot."],
  ["Nunki", 92855, ["teapot"], ""],
  ["Menkar", 14135, [], ""],
];

const DEEP_SKY: [string, string, string[]?, string?][] = [
  ["Andromeda Galaxy", "M 31", ["m31"], "2.5 million light-years away, visible to the eye from dark sites."],
  ["Orion Nebula", "M 42", ["m42"], "Star nursery under Orion's Belt. Binoculars!"],
  ["Pleiades", "M 45", ["seven sisters", "m45"], "Tight cluster of young blue stars."],
  ["Beehive Cluster", "M 44", ["praesepe", "m44"], ""],
  ["Hercules Cluster", "M 13", ["m13"], "Hundreds of thousands of stars in a ball."],
  ["Lagoon Nebula", "M 8", ["m8"], ""],
  ["Eagle Nebula", "M 16", ["pillars of creation", "m16"], ""],
  ["Trifid Nebula", "M 20", ["m20"], ""],
  ["Dumbbell Nebula", "M 27", ["m27"], ""],
  ["Ring Nebula", "M 57", ["m57"], "A dying star's smoke ring in Lyra."],
  ["Crab Nebula", "M 1", ["m1"], "Remains of a supernova seen in 1054."],
  ["Triangulum Galaxy", "M 33", ["m33"], ""],
  ["Whirlpool Galaxy", "M 51", ["m51"], ""],
  ["Bode's Galaxy", "M 81", ["m81"], ""],
  ["Cigar Galaxy", "M 82", ["m82"], ""],
  ["Pinwheel Galaxy", "M 101", ["m101"], ""],
  ["Sombrero Galaxy", "M 104", ["m104"], ""],
  ["Double Cluster", "NGC 869", ["h and chi persei"], "Two clusters side by side in Perseus."],
];

/** Constellations come from the sky culture file (88, with English names). */
async function loadConstellations(skyBase: string): Promise<Entry[]> {
  const res = await fetch(skyBase + "skycultures/western/index.json");
  const data = await res.json();
  return (data.constellations as any[]).map((c) => ({
    name: c.common_name?.native ?? c.iau,
    aliases: [c.common_name?.english, c.iau].filter(Boolean),
    kind: "constellation" as const,
    ids: [c.id],
    blurb: c.common_name?.english ? `The ${c.common_name.english}.` : undefined,
  }));
}

export async function buildCatalog(skyBase: string): Promise<Entry[]> {
  const stars: Entry[] = STARS.map(([name, hip, aliases, blurb]) => ({
    name,
    aliases,
    kind: "star",
    // HIP first: it's a direct tile lookup; "NAME …" scans every loaded object.
    ids: [`HIP ${hip}`, `NAME ${name}`],
    blurb: blurb || undefined,
  }));
  const dsos: Entry[] = DEEP_SKY.map(([name, id, aliases, blurb]) => ({
    name,
    aliases,
    kind: "deep-sky",
    ids: [id, `NAME ${name}`],
    blurb: blurb || undefined,
  }));
  let constellations: Entry[] = [];
  try {
    constellations = await loadConstellations(skyBase);
  } catch {
    /* offline edge cases: search still works for everything else */
  }
  return [...PLANETS, ...stars, ...constellations, ...dsos];
}

const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "");

/** Rank: prefix of name > prefix of alias > word prefix > substring. */
export function search(catalog: Entry[], query: string, limit = 12): Entry[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: [number, Entry][] = [];
  for (const e of catalog) {
    const names = [e.name, ...(e.aliases ?? [])].map(fold);
    let score = 0;
    names.forEach((n, i) => {
      if (n === q) score = Math.max(score, 100 - i);
      else if (n.startsWith(q)) score = Math.max(score, 80 - i);
      else if (n.split(" ").some((w) => w.startsWith(q))) score = Math.max(score, 60 - i);
      else if (n.includes(q)) score = Math.max(score, 40 - i);
    });
    if (score) {
      const kindBoost = e.kind === "planet" ? 5 : e.kind === "star" ? 3 : 0;
      scored.push([score + kindBoost, e]);
    }
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, e]) => e);
}

/**
 * Resolved objects, cached per entry. Engine lookups return a retained
 * reference that SweObj never releases, so resolving once avoids leaking a
 * reference (and pinning a tile) on every keystroke.
 */
const resolved = new WeakMap<Entry, SweObj>();

export function isResolved(e: Entry): boolean {
  return resolved.has(e);
}

export function resolve(stel: Stel, e: Entry): SweObj | null {
  const cached = resolved.get(e);
  if (cached) return cached;
  for (const id of e.ids) {
    try {
      const hip = /^HIP (\d+)$/.exec(id);
      const o = hip ? starByHip(stel, Number(hip[1])) : stel.getObj(id);
      if (o) {
        resolved.set(e, o);
        return o;
      }
    } catch {
      /* try the next designation */
    }
  }
  return null;
}
