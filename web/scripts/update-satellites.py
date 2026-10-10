#!/usr/bin/env python3
"""Refresh satellite orbits (TLEs) from CelesTrak in the engine's jsonl format.

The engine's bundled tle_satellite.jsonl.gz dates from January 2020, and the
engine still propagates it, so the ISS would show up in the wrong place.
This pulls CelesTrak's "visual" (brightest ~150) and "stations" groups and
writes them in the same schema. Keeps metadata (magnitude, owner…) from the
old file where the NORAD number matches.

Usage: update-satellites.py <old.jsonl.gz> <out.jsonl.gz>
"""
import gzip, json, sys, urllib.request

GROUPS = ["visual", "stations"]
URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={}&FORMAT=tle"

def fetch(group):
    req = urllib.request.Request(URL.format(group), headers={"User-Agent": "star-map-prototype"})
    lines = urllib.request.urlopen(req, timeout=20).read().decode().strip().splitlines()
    for i in range(0, len(lines) - 2, 3):
        yield lines[i].strip(), lines[i + 1].rstrip(), lines[i + 2].rstrip()

def main(old_path, out_path):
    old = {}
    with gzip.open(old_path, "rt") as f:
        for line in f:
            if line.strip():
                d = json.loads(line)
                old[d["model_data"]["norad_number"]] = d
    out, seen = [], set()
    for group in GROUPS:
        for name, l1, l2 in fetch(group):
            norad = int(l1[2:7])
            if norad in seen:
                continue
            seen.add(norad)
            d = old.get(norad) or {
                "types": ["Asa"], "model": "tle_satellite",
                "model_data": {"norad_number": norad, "group": ["Visual"]},
                "names": [f"NAME {name}", f"NORAD {norad}"],
                "short_name": name, "interest": 3.1,
            }
            d["model_data"]["tle"] = [l1, l2]
            d["model_data"]["designation"] = l1[9:17].strip()
            out.append(d)
    if len(out) < 20:
        raise SystemExit(f"Only {len(out)} satellites fetched; keeping old file")
    with gzip.open(out_path, "wt") as f:
        for d in out:
            f.write(json.dumps(d) + "\n")
    iss = next((d for d in out if d["model_data"]["norad_number"] == 25544), None)
    print(f"Wrote {len(out)} satellites; ISS epoch {iss['model_data']['tle'][0][18:32] if iss else 'missing'}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
