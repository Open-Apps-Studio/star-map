#!/bin/sh
# Build the sky page (../web) and copy it into ./sky, which the iOS build
# bundles as a folder (see plugins/with-sky-bundle.js). ./sky is committed so
# EAS cloud builds don't need emsdk or the engine build.
set -e
cd "$(dirname "$0")/.."
(cd ../web && npm run build)
rm -rf sky && cp -R ../web/dist sky
du -sh sky
