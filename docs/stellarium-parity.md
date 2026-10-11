# Stellarium Mobile Plus parity

Checklist from the RASC "Stellarium Mobile Product Comparison" (free vs Plus)
and Stellarium Labs' Plus page, with where each lives in Star Map.
Status as of build 5 (2026-10-11).

| Plus feature | Star Map | Where |
| --- | --- | --- |
| Stars to mag 24 | Offline to mag 8 (Stellarium Mobile's own packs); online to mag 12 (extended pack) then Gaia DR3 (~mag 20) | `engine.ts` `addOnlineSources` |
| Star magnitude limit / brightness / label density | Settings › Stars, Labels | `ui/settings-page.ts` |
| DSOs to mag 18, high-res imagery | Offline bright DSOs; online extended catalogue + DSS colour photos | `engine.ts`, Layers › Sky photos |
| Planet / DSO / satellite label density | Settings › Labels | |
| Planet high-res imagery | Bundled CC BY maps; online Stellarium Moon | `data/planets`, `addOnlineSources` |
| Planet & ISS 3D interactive views | three.js globes lit/oriented as seen, real moon positions; NASA ISS + Hubble models | `ui/view3d.ts` |
| Equatorial grids (J2000 + date), ecliptic, meridian, equator, azimuthal grid, cardinals | Layers › Grids & Lines; Settings › Cardinal points | `ui/layers.ts` |
| Light pollution, ground fog, atmosphere | Settings › Sky; Layers | |
| Planets & satellites visible tonight | Observe › Tonight (planet bars, satellite passes, best DSOs) | `ui/observe.ts`, `events.ts` |
| Calendar with solar-system events | Observe › Calendar (12 months, geocentric timing, local eclipse circumstances, meteor peaks) | `events.ts` |
| Eyepiece / camera / Telrad oculars, FOV simulator | Instruments (+ binoculars), overlay on sky | `ocular.ts`, `ui/instruments.ts` |
| Telescope control | Stellarium protocol + LX200 over TCP, reticle, Slew | `app/modules/star-motion/ios/TelescopeClient.swift`, `telescope.ts` |
| Interactive visibility elevation graph | Object card, drag to scrub time | `ui/altgraph.ts` |
| Start-up time control | Settings › Startup | |
| Sky cultures, landscapes | All 34 cultures, 6 landscapes, bundled | `data/skydata` via `web/scripts/fetch-skydata.py` |
| Search by name, category, favourites | Full offline index (53k stars, 12.7k DSOs, 14k minor bodies/satellites), favourites | `search-index.ts`, `ui/search.ts` |
| Sensor (point at the sky), night mode, time travel | Yes | |

## Known gaps / not verified

- Stellarium Mobile bundles ~2.5M stars offline; we bundle mag ≤ 8 and stream
  the rest (HTTP-cached). An offline download option would need a native
  file store the WebView can read.
- Not tested on a real phone yet: pointing mode with CoreMotion, telescope
  over real Wi-Fi hardware (tested against a mock server for both protocols),
  memory/performance with Gaia + DSS streaming.
- English only (Stellarium Mobile is translated).

## Data sources

Stellarium's public CDN (`stellarium.sfo2.cdn.digitaloceanspaces.com`), the same
files stellarium-web.org uses. Newer files are zstd-compressed with a column
shuffle; `engine/src/eph-file.c` handles both formats.
