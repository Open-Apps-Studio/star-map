#!/usr/bin/env python3
"""Names for the Settings pickers: sky cultures (from each description.md
title and index.json region) and landscapes (title + first sentence).
Usage: build-meta.py <skydata dir>  → <skydata dir>/meta.json"""
import html, json, os, re, sys

root = sys.argv[1]
cultures = []
for cid in json.load(open(f"{root}/skycultures/index.json")):
    idx = json.load(open(f"{root}/skycultures/{cid}/index.json"))
    title = cid
    try:
        first = open(f"{root}/skycultures/{cid}/description.md", encoding="utf-8").readline()
        title = first.lstrip("# ").strip() or cid
    except FileNotFoundError:
        pass
    cultures.append({"id": cid, "name": title, "region": idx.get("region", ""), "art": any(c.get("image") for c in idx.get("constellations", []))})
landscapes = []
for lid in json.load(open(f"{root}/landscapes/index.json")):
    text = open(f"{root}/landscapes/{lid}/description.en.utf8", encoding="utf-8").read()
    name = re.search(r"<h2>(.*?)</h2>", text)
    body = re.sub(r"<[^>]+>", " ", re.sub(r"<h2>.*?</h2>", "", text, count=1))
    body = html.unescape(" ".join(body.split()))
    sentence = re.split(r"(?<=[.!?])\s", body, maxsplit=1)[0]
    if sentence.startswith("Made with"):
        sentence = ""  # a tool credit, not a description
    landscapes.append({"id": lid, "name": html.unescape(name.group(1)) if name else lid, "blurb": sentence[:140]})
cultures.sort(key=lambda c: (c["id"] != "western", c["name"]))
json.dump({"skycultures": cultures, "landscapes": landscapes}, open(f"{root}/meta.json", "w"), ensure_ascii=False, indent=1)
print(f"meta: {len(cultures)} sky cultures, {len(landscapes)} landscapes")
