/**
 * Fresh satellite orbits at runtime.
 *
 * Orbital elements (TLEs) go stale in days: a month-old ISS orbit puts the
 * station minutes and many degrees away from where it really is. The bundled
 * file is only as fresh as the last build, so the phone pulls CelesTrak's
 * "visual" (brightest ~150) and "stations" groups itself, at most every
 * 12 hours (CelesTrak blocks clients that re-download within 2 hours), and
 * keeps the result for offline use. Metadata the engine uses for brightness
 * (standard magnitude, owner, launch date…) is merged from the bundled file.
 */
const CACHE_KEY = "tle-cache-v1";
const MAX_AGE_MS = 12 * 3600e3;
const GROUPS = ["visual", "stations"];
const groupUrl = (g: string) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`;

interface Cache {
  t: number;
  jsonl: string;
}

function readCache(): Cache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    return c && typeof c.t === "number" && typeof c.jsonl === "string" ? c : null;
  } catch {
    return null;
  }
}

/** XHR, not fetch: WKWebView's fetch() can't read file:// URLs. */
function getBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("GET", url);
    x.responseType = "arraybuffer";
    x.timeout = timeoutMs;
    x.onload = () => (x.status === 200 || (x.status === 0 && x.response?.byteLength) ? resolve(new Uint8Array(x.response)) : reject(new Error(`HTTP ${x.status}`)));
    x.onerror = x.ontimeout = () => reject(new Error("network"));
    x.send();
  });
}

async function gunzipText(bytes: Uint8Array): Promise<string> {
  // Vite serves .gz with Content-Encoding (already inflated); the app reads the raw file.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function parseTle(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const out: { name: string; l1: string; l2: string }[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const [name, l1, l2] = [lines[i]?.trim(), lines[i + 1]?.trimEnd(), lines[i + 2]?.trimEnd()];
    if (name && l1?.startsWith("1 ") && l2?.startsWith("2 ")) out.push({ name, l1, l2 });
  }
  return out;
}

/** Bundled satellite records by NORAD number (names, magnitudes, owners…). */
async function bundledMeta(bundledUrl: string) {
  const meta = new Map<number, any>();
  try {
    for (const line of (await gunzipText(await getBytes(bundledUrl, 8000))).split("\n")) {
      if (!line.trim()) continue;
      const d = JSON.parse(line);
      meta.set(d.model_data.norad_number, d);
    }
  } catch {
    /* metadata is a nice-to-have */
  }
  return meta;
}

/** CelesTrak's visual + stations groups. */
async function fromCelestrak() {
  const texts = await Promise.all(GROUPS.map((g) => getBytes(groupUrl(g), 8000).then((b) => new TextDecoder().decode(b))));
  return { tles: texts.flatMap(parseTle), onlyKnown: false };
}

/** SatNOGS (Space-Track TLEs, no rate limit): fallback when CelesTrak refuses. Fewer bright satellites, but has the stations. */
async function fromSatnogs() {
  const rows = JSON.parse(new TextDecoder().decode(await getBytes("https://db.satnogs.org/api/tle/?format=json", 15000))) as { tle0: string; tle1: string; tle2: string }[];
  return { tles: rows.map((r) => ({ name: r.tle0.replace(/^0 /, "").trim(), l1: r.tle1.trim(), l2: r.tle2.trim() })), onlyKnown: true };
}

async function refresh(bundledUrl: string): Promise<string> {
  const [src, meta] = await Promise.all([fromCelestrak().catch(fromSatnogs), bundledMeta(bundledUrl)]);
  const STATIONS = new Set([25544, 48274]); // ISS, Tiangong
  const seen = new Set<number>();
  const rows: string[] = [];
  for (const { name, l1, l2 } of src.tles) {
    const norad = parseInt(l1.slice(2, 7), 10);
    if (!norad || seen.has(norad)) continue;
    // SatNOGS lists ~1700 mostly faint radio satellites: keep the ones we know.
    if (src.onlyKnown && !meta.has(norad) && !STATIONS.has(norad)) continue;
    seen.add(norad);
    const d = structuredClone(meta.get(norad)) ?? {
      types: ["Asa"], model: "tle_satellite",
      model_data: { norad_number: norad, group: ["Visual"] },
      names: [`NAME ${name}`, `NORAD ${norad}`], short_name: name, interest: 3.1,
    };
    d.model_data.tle = [l1, l2];
    d.model_data.designation = l1.slice(9, 17).trim();
    rows.push(JSON.stringify(d));
  }
  if (rows.length < 20) throw new Error(`only ${rows.length} satellites`);
  return rows.join("\n") + "\n";
}

/** Satellites in the file the engine loaded (for pass predictions). */
export interface SatInfo {
  id: string;
  name: string;
  mag: number | null;
}
let loaded: SatInfo[] = [];
export const loadedSatellites = () => loaded;

/** Resolves once we know which satellite file the engine gets. */
let decided: () => void = () => {};
export const satelliteSourceDecided = new Promise<void>((r) => (decided = r));

function remember(jsonl: string) {
  loaded = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      const mag = d.model_data?.mag;
      loaded.push({ id: `NORAD ${d.model_data.norad_number}`, name: d.short_name ?? d.names?.[0]?.replace(/^NAME /, "") ?? "", mag: typeof mag === "number" ? mag : null });
    } catch {
      /* skip */
    }
  }
}

const blobUrl = (jsonl: string) => URL.createObjectURL(new Blob([jsonl], { type: "application/x-ndjson" }));

/**
 * URL of the freshest satellite file we can get: today's cache, else a new
 * download, else an older cache, else the bundled file.
 */
export async function satelliteSource(bundledUrl: string): Promise<{ url: string; fresh: boolean; ageHours: number | null }> {
  try {
    return await pickSource(bundledUrl);
  } finally {
    decided();
  }
}

async function pickSource(bundledUrl: string): Promise<{ url: string; fresh: boolean; ageHours: number | null }> {
  const cached = readCache();
  const age = cached ? Date.now() - cached.t : Infinity;
  if (cached && age < MAX_AGE_MS) {
    remember(cached.jsonl);
    return { url: blobUrl(cached.jsonl), fresh: true, ageHours: age / 3600e3 };
  }
  try {
    const jsonl = await refresh(bundledUrl);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), jsonl }));
    } catch {
      /* storage full or blocked: still use it this session */
    }
    remember(jsonl);
    return { url: blobUrl(jsonl), fresh: true, ageHours: 0 };
  } catch {
    if (cached) {
      remember(cached.jsonl);
      return { url: blobUrl(cached.jsonl), fresh: false, ageHours: age / 3600e3 };
    }
    return { url: bundledUrl, fresh: false, ageHours: null };
  }
}
