#!/usr/bin/env python3
"""
Build the offline search index from the bundled eph catalogues, so search can
find any bundled star or deep-sky object by any of its names or catalogue
numbers (M 13, NGC 7000, HIP 11767, HD 8890, alf UMi, Polaris...), even when its
sky tile isn't loaded yet. Search then points the view there and resolves the
object once the tile streams in.

Also lists the solar-system minor bodies and satellites the engine loads
(asteroids from mpcorb.dat, comets from CometEls.txt, satellites from the TLE
file), with the engine designation that finds each one.

Output (compact JSON):
  {"stars": [[ids, ra, de, vmag], ...],
   "dsos": [[ids, ra, de, vmag, type], ...],
   "minor": [[name, engine id, kind], ...]}   kind: asteroid | comet | satellite
ids is the engine's '|' separated designation list; ra/de in degrees.

Usage: build-search-index.py <skydata dir> <out json>
"""
import glob
import json
import math
import struct
import sys

import numpy as np
import zstandard

ROOT, OUT = sys.argv[1], sys.argv[2]


def read_tables(path):
    d = open(path, "rb").read()
    o = 8
    while o < len(d):
        typ = d[o:o + 4]
        ln = struct.unpack("<i", d[o + 4:o + 8])[0]
        body = d[o + 8:o + 8 + ln]
        if typ in (b"STAR", b"DSO ", b"GAIA"):
            p = 12
            flags, rs, nc, nr = struct.unpack("<4i", body[p:p + 16])
            p += 16
            cols = {}
            for _ in range(nc):
                nm, tp, unit, start, size = struct.unpack("<4s4siii", body[p:p + 20])
                p += 20
                cols[nm.strip(b"\0").decode()] = (tp[:1].decode(), start, size)
            size, cs = struct.unpack("<ii", body[p:p + 8])
            raw = zstandard.ZstdDecompressor().decompress(body[p + 8:p + 8 + cs], max_output_size=size)
            a = np.frombuffer(raw, np.uint8)
            assert flags & 4, "only the column-shuffled format is handled"

            def col(name):
                t, st, sz = cols[name]
                if t == "s":
                    blk = a[st * nr:(st + sz) * nr].reshape(nr, sz)
                    return [r.tobytes().split(b"\0")[0].decode("utf-8", "replace") for r in blk]
                m = a[st * nr:(st + sz) * nr].reshape(sz, nr).T.copy()
                return np.frombuffer(m.tobytes(), {"f": "<f4", "i": "<i4", "Q": "<u8"}[t]).tolist()

            yield typ, cols, nr, col
        o += 8 + ln + 4


# Designations people search for. Survey-only ones (BD, SAO, WDS, IRAS,
# 2MASS, MCG...) stay in the engine but are left out of the index.
KEEP = ("NAME ", "M ", "NGC ", "IC ", "C ", "HIP ", "HD ", "* ", "V* ", "Mel ", "Cr ", "SH 2-", "UGC ", "Abell ", "Barnard ", "B ", "LDN ", "Sh2-")


def ids_clean(s):
    # '#X' tokens are internal markers, not names.
    return "|".join(i for i in s.split("|") if i.startswith(KEEP))


stars, dsos, seen = [], [], set()
for path in sorted(glob.glob(f"{ROOT}/stars/*/Norder*/Dir*/*.eph")):
    for typ, cols, nr, col in read_tables(path):
        ids, ra, de, vm = col("ids"), col("ra"), col("de"), col("vmag")
        hip = col("hip") if "hip" in cols else [0] * nr
        for i in range(nr):
            names = ids_clean(ids[i])
            if hip[i] and f"HIP {hip[i]}" not in names.split("|"):
                names = f"{names}|HIP {hip[i]}" if names else f"HIP {hip[i]}"
            if not names or names in seen:
                continue
            seen.add(names)
            stars.append([names, round(math.degrees(ra[i]), 3), round(math.degrees(de[i]), 3), round(vm[i], 1)])
for path in sorted(glob.glob(f"{ROOT}/dsos/*/Norder*/Dir*/*.eph")):
    for typ, cols, nr, col in read_tables(path):
        ids, ra, de, vm, tp = col("ids"), col("ra"), col("de"), col("vmag"), col("type")
        bm = col("bmag")
        for i in range(nr):
            names = ids_clean(ids[i])
            if not names:
                continue
            mag = vm[i] if not math.isnan(vm[i]) else bm[i]
            dsos.append([names, round(math.degrees(ra[i]), 3), round(math.degrees(de[i]), 3),
                         None if math.isnan(mag) else round(mag, 1), tp[i]])
minor = []
# MPCORB: readable designation in columns 167-194, e.g. "(1) Ceres".
for line in open(f"{ROOT}/mpcorb.dat", encoding="latin-1"):
    des = line[166:194].strip()
    if des.startswith("("):
        name = des.split(")", 1)[1].strip()
        minor.append([name or des, f"MPC {des}", "asteroid"])
# CometEls: designation and name in columns 103-158, e.g. "C/2023 A3 (Tsuchinshan-ATLAS)".
try:
    for line in open(f"{ROOT}/CometEls.txt", encoding="latin-1"):
        des = line[102:158].strip()
        if des:
            minor.append([des, f"NAME {des}", "comet"])
except FileNotFoundError:
    pass
try:
    import gzip
    for line in gzip.open(f"{ROOT}/tle_satellite.jsonl.gz", "rt"):
        sat = json.loads(line)
        nm = (sat.get("short_name") or sat.get("names", [None])[0] or "").strip()
        num = sat.get("model_data", {}).get("norad_number")
        if nm and num:
            minor.append([nm, f"NORAD {num}", "satellite"])
except FileNotFoundError:
    pass
json.dump({"stars": stars, "dsos": dsos, "minor": minor}, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
print(f"{len(stars)} stars, {len(dsos)} DSOs, {len(minor)} minor bodies and satellites")
