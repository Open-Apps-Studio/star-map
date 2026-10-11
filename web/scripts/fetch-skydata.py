#!/usr/bin/env python3
"""
Mirror the offline sky data the app bundles, from Stellarium's public data CDN
(the same files stellarium-web.org and Stellarium Mobile use):

  stars/minimal, stars/base   stars to magnitude 8 (Stellarium Mobile's packs)
  dsos/base                   the bright deep-sky catalogue
  skycultures/*               all 34 sky cultures (lines, names, artwork)
  landscapes/*                the 6 landscapes
  mpcorb.dat                  20,000 brightest asteroids
  meteor-showers.json         IAU meteor showers (for the calendar)

Deeper data (stars to mag 12, Gaia DR3 beyond, the extended DSO catalogue and
DSS sky photos) streams from the CDN at runtime when online.

Usage: fetch-skydata.py <out_dir>    (idempotent; skips files already there)
"""
import concurrent.futures as cf
import json
import os
import sys
import urllib.request

CDN = "https://stellarium.sfo2.cdn.digitaloceanspaces.com/stellarium-web/libswe-1.17.0"
OUT = sys.argv[1] if len(sys.argv) > 1 else "data/skydata"


def get(url: str) -> bytes | None:
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return r.read()
    except Exception:
        return None


def save(rel: str, src: str | None = None) -> bool:
    """Download CDN/<src or rel> to OUT/<rel>. True if the file exists after."""
    path = os.path.join(OUT, rel)
    if os.path.exists(path):
        return True
    data = get(f"{CDN}/{src or rel}")
    if data is None:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return True


def tile(order: int, pix: int, ext: str) -> str:
    return f"Norder{order}/Dir{(pix // 10000) * 10000}/Npix{pix}.{ext}"


def mirror_hips(rel: str, ext: str, max_order: int = 9) -> None:
    """A HiPS survey: properties, Allsky, then every tile that exists, walking
    down only from tiles that exist."""
    save(f"{rel}/properties")
    save(f"{rel}/Norder0/Allsky.{ext}")
    pix = list(range(12))
    with cf.ThreadPoolExecutor(32) as ex:
        for order in range(max_order + 1):
            found = [p for p, ok in zip(pix, ex.map(lambda p: save(f"{rel}/{tile(order, p, ext)}"), pix)) if ok]
            print(f"  {rel} order {order}: {len(found)} tiles", flush=True)
            if not found:
                break
            pix = [p * 4 + k for p in found for k in range(4)]


# IAU constellation boundaries. The newer sky culture files say
# "edges_type": "IAU" instead of embedding them, but this engine version
# reads them from the file, so merge them back in.
EDGES_FROM = os.path.join(os.path.dirname(__file__), "../../engine/apps/test-skydata/skycultures/western/index.json")


def mirror_skycultures() -> None:
    names = json.loads(get(f"{CDN}/skycultures/index.json"))
    os.makedirs(f"{OUT}/skycultures", exist_ok=True)
    with open(f"{OUT}/skycultures/index.json", "w") as f:
        json.dump(names, f, indent=1)
    for name in names:
        save(f"skycultures/{name}/index.json")
        save(f"skycultures/{name}/description.md")
        with open(f"{OUT}/skycultures/{name}/index.json") as f:
            idx = json.load(f)
        files = {c["image"]["file"] for c in idx.get("constellations", []) if c.get("image", {}).get("file")}
        if idx.get("thumbnail"):
            files.add(idx["thumbnail"])
        with cf.ThreadPoolExecutor(16) as ex:
            list(ex.map(lambda fn: save(f"skycultures/{name}/{fn}"), files))
        if idx.get("edges_type") == "IAU" and "edges" not in idx:
            with open(EDGES_FROM) as f:
                idx["edges"] = json.load(f)["edges"]
            with open(f"{OUT}/skycultures/{name}/index.json", "w") as f:
                json.dump(idx, f)
        print(f"  skyculture {name}: {len(files)} images", flush=True)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for rel in ("stars/minimal", "stars/base"):
        mirror_hips(rel, "eph")
    mirror_hips("dsos/base", "eph")
    mirror_skycultures()
    landscapes = [n for n in json.loads(get(f"{CDN}/landscapes/index.json")) if n != "zero"]
    for name in landscapes:
        save(f"landscapes/{name}/description.en.utf8")
        mirror_hips(f"landscapes/{name}", "webp", 4)
    with open(f"{OUT}/landscapes/index.json", "w") as f:
        json.dump(landscapes, f, indent=1)
    save("mpcorb.dat")
    save("meteor-showers.json")


if __name__ == "__main__":
    main()
