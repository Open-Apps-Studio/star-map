#!/bin/sh
# Copy the compiled engine and sky data into public/ so Vite serves them.
set -e
cd "$(dirname "$0")/.."
E=../engine
mkdir -p public/engine public/skydata public/fonts
cp $E/build/stellarium-web-engine.js public/engine/   # wasm is embedded (SINGLE_FILE)
rsync -a --delete $E/apps/test-skydata/ public/skydata/
# Stellarium Mobile's offline packs replace the small test catalogues:
# stars to mag 8, bright DSOs, all sky cultures, landscapes, 20k asteroids
# (mirrored by scripts/fetch-skydata.py into ../data/skydata).
rm -rf public/skydata/stars public/skydata/dso public/skydata/skycultures public/skydata/landscapes
rsync -a ../data/skydata/ public/skydata/
# Fresh satellite orbits (the bundled ones are from 2020). Offline? Keep old.
python3 ./scripts/update-satellites.py $E/apps/test-skydata/tle_satellite.jsonl.gz public/skydata/tle_satellite.jsonl.gz \
  || echo "satellite refresh skipped"
# Fresh comet orbits from the Minor Planet Center (bundled file is from 2020).
curl -sf --max-time 20 -o public/skydata/CometEls.txt.new https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt \
  && [ "$(wc -l < public/skydata/CometEls.txt.new)" -gt 100 ] && mv public/skydata/CometEls.txt.new public/skydata/CometEls.txt \
  || { rm -f public/skydata/CometEls.txt.new; echo "comet refresh skipped"; }
cp ../engine/apps/simple-html/static/fonts/Roboto-*.ttf public/fonts/ 2>/dev/null || true
# Planet surface textures (HiPS order 0, generated from CC BY 4.0 maps).
rsync -a ../data/planets/ public/skydata/planets/
# 3D view: planet maps (CC BY 4.0) and NASA models (public domain).
rsync -a ../data/textures3d/ public/textures3d/
rsync -a ../data/models3d/ public/models3d/
# Ambient soundtrack (Settings > Sound).
rsync -a ../data/audio/ public/audio/
# Offline search index over every bundled star, DSO, asteroid, comet and
# satellite (after the comet/satellite refresh above).
uv run -q --with zstandard --with numpy python ./scripts/build-search-index.py public/skydata public/skydata/search-index.json
python3 ./scripts/build-meta.py public/skydata
