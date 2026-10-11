# Stellarium Mobile Plus parity

Checklist from the RASC "Stellarium Mobile Product Comparison" (free vs Plus)
and Stellarium Labs' Plus page, with where each lives in Star Map.
Status as of build 8 (2026-10-12).

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

## Beyond Stellarium: what the other paid apps sell

Checked against the App Store listings of Sky Guide, Night Sky, Sky Tonight
and Star Walk 2 (2026-10-12).

| Paid feature (who sells it) | Star Map | Where |
| --- | --- | --- |
| AR camera view (all of them) | Pointing mode › camera button: live camera behind a see-through sky | `ar.ts`, engine `render_set_transparent`, `app/src/app/index.tsx` |
| ISS pass alerts (Sky Guide) | Settings › Alerts › ISS flyovers, 5 min before each visible pass, next 4 days | `alerts.ts` |
| Event reminders (Sky Tonight) | Bell on every satellite pass and calendar event; Settings › Alerts › Sky events | `alerts.ts` |
| Weather / stargazing index (Sky Tonight, Sky Guide, Night Sky) | Tonight › Conditions: score, hourly clouds, 7-night outlook (Open-Meteo) | `conditions.ts` |
| Trajectories / sky curves (Sky Tonight) | Card › Path tonight: horizon-fixed arc with hour marks | `ui/path.ts` |
| Sun warning (Night Sky) | Red banner when pointing within 20° of the Sun | `ui/pointer.ts` |
| Deep-sky photos (Sky Guide, Star Walk) | DSS colour cut-outs on Tonight targets and cards (online) | `dso-photo.ts` |
| Ambient soundtrack (Sky Guide) | Settings › Sound › Ambient music | `ambient.ts`, `data/audio` |
| Planetary moons (Sky Guide 12) | Search finds Pluto and 19 moons | `catalog.ts` |
| Fresh satellite orbits | Phone downloads CelesTrak (SatNOGS fallback) every 12 h | `satellites.ts` |

Not done: widgets / Apple Watch, AI guide (Night Sky Aura), photo editor
(Sky Tonight), SharePlay, translations.

## Known gaps / not verified

- Stellarium Mobile bundles ~2.5M stars offline; we bundle mag ≤ 8 and stream
  the rest (HTTP-cached). An offline download option would need a native
  file store the WebView can read.
- Not tested on a real phone yet: pointing mode with CoreMotion, the AR
  camera (the simulator has no camera; transparency verified in a browser),
  notification delivery, telescope over real Wi-Fi hardware (tested against a
  mock server for both protocols), memory/performance with Gaia + DSS streaming.
- CelesTrak rate-limits by IP (403 when the same group is fetched twice in
  2 hours); the build and the app fall back to SatNOGS, which has fewer of the
  bright satellites.
- English only (Stellarium Mobile is translated).

## Data sources

Stellarium's public CDN (`stellarium.sfo2.cdn.digitaloceanspaces.com`), the same
files stellarium-web.org uses. Newer files are zstd-compressed with a column
shuffle; `engine/src/eph-file.c` handles both formats.
