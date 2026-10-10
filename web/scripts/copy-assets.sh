#!/bin/sh
# Copy the compiled engine and sky data into public/ so Vite serves them.
set -e
cd "$(dirname "$0")/.."
E=../engine
mkdir -p public/engine public/skydata
cp $E/build/stellarium-web-engine.js $E/build/stellarium-web-engine.wasm public/engine/
rsync -a --delete $E/apps/test-skydata/ public/skydata/
# Fresh satellite orbits (the bundled ones are from 2020). Offline? Keep old.
python3 ./scripts/update-satellites.py $E/apps/test-skydata/tle_satellite.jsonl.gz public/skydata/tle_satellite.jsonl.gz \
  || echo "satellite refresh skipped"
# Fresh comet orbits from the Minor Planet Center (bundled file is from 2020).
curl -sf --max-time 20 -o public/skydata/CometEls.txt.new https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt \
  && [ "$(wc -l < public/skydata/CometEls.txt.new)" -gt 100 ] && mv public/skydata/CometEls.txt.new public/skydata/CometEls.txt \
  || { rm -f public/skydata/CometEls.txt.new; echo "comet refresh skipped"; }
