# (Open Source) Star Map

A star map for iPhone with nothing locked. Point your phone at the sky and see every star, planet, constellation, galaxy and satellite, plus what's worth looking at tonight.

By [Open Apps Studio](https://openappsstudio.com). No ads, no accounts, no paywalls, no "Plus" tier.

<!-- [Download on the App Store](https://apps.apple.com/app/id6821444135) -->

## Why

Every good star app on the App Store locks the useful stuff. Stellarium Mobile wants $1.99–$18.99 for moving time forward and the events calendar, Sky Guide sells "All Constellations" for $1.99 and subscriptions up to $249.99, Night Sky and Sky Tonight put tonight's best targets and reminders behind a subscription. One App Store review of Stellarium Mobile says it pretty well: "simply moving time forwards is a paid feature??"

Star Map gives you all of it, and the code is right here.

## What it does

**The sky**
- Point your phone at the sky (gyroscope + compass, true north when location is on), or drag around with your finger.
- AR mode: the camera view behind the sky, with stars, lines and names drawn over the real thing.
- Stars to magnitude 8 offline, deeper (Gaia DR3) when online. Planets with real surfaces, the Moon with its phase, comets, 20,000 asteroids, satellites with today's orbits.
- All 88 constellations with lines, names and artwork, plus 34 other sky cultures (Chinese, Norse, Māori, Navajo, Egyptian…).
- Grids and lines (equatorial, azimuthal, ecliptic, meridian), atmosphere, light pollution (Bortle 1–9), landscapes, meteor showers, night mode.

**Planning a night out**
- Tonight: sunset, darkness, dawn, the Moon, a timeline of when each planet is up, visible satellite passes (ISS, Tiangong, Hubble, the bright ones), and the best deep-sky targets with real photos.
- Conditions: hourly cloud cover, humidity, wind and a 0–100 stargazing score for tonight and the next 6 nights (weather from Open-Meteo).
- Calendar: 12 months of eclipses (with local circumstances), meteor shower peaks, oppositions, elongations, conjunctions, Moon phases and seasons.
- Alerts: a notification 5 minutes before every visible ISS pass, and before the big sky events. Or tap the bell on any single pass or event.

**Looking closer**
- Tap anything for its card: where it is now, rise/set/transit, best time tonight, an altitude graph you can scrub, distance, magnitude, size, a Wikipedia summary.
- Path tonight: the object's track across your sky with hour marks.
- 3D view of the planets (lit and oriented as seen right now, with their moons) and of the ISS and Hubble.
- Eyepiece, camera, binocular and Telrad field-of-view overlays for your own gear.
- Telescope control over Wi-Fi (Stellarium protocol and LX200, so SynScan, SkyFi, StarSense, OnStep, INDI/ASCOM bridges).
- Search everything offline: 53k stars, 12.7k deep-sky objects, planets and their moons, asteroids, comets, satellites, by any catalogue name (M 31, NGC 7000, HIP 11767, α UMi…).

**Small things**
- Time travel with a speed slider, the Moon phase for any date, a Sun warning when you point near it, an ambient soundtrack (off by default), favourites, sharing a snapshot of the sky.

## How it's built

The sky itself is [Stellarium Web Engine](https://github.com/Stellarium/stellarium-web-engine) (the C engine behind stellarium-web.org), compiled to WebAssembly and running fully on the phone. Everything around it is ours.

| Folder | What's in it |
| --- | --- |
| `engine/` | Stellarium Web Engine at upstream commit `15cd08a2`, with our patches (60 fps on high-dpi screens, touch cancel, render-loop recovery, WebGL context loss, zstd data files, transparent clear for AR, and a few more). Build with `engine/build-wasm.sh` (emsdk). |
| `web/` | The sky page (TypeScript + Vite): UI, search, Tonight, calendar, alerts, conditions, 3D view (three.js), instruments, telescope. All the app's screens live here so it also runs in a browser. |
| `app/` | The iOS app (Expo SDK 57): a full-screen WebView over the sky page, plus native bits a web page can't do well: CoreMotion pointing (`modules/star-motion`), the telescope TCP client, camera, notifications, haptics, location, sharing. |
| `data/` | Bundled offline data: sky packs mirrored from Stellarium's data server, planet maps, NASA models, the ambient track. |
| `docs/` | Feature checklist against Stellarium Mobile Plus and the other paid apps. |

### Running it

```bash
# the sky page in a browser (needs the engine built once: engine/build-wasm.sh)
cd web && npm install && npm run dev      # http://localhost:5180

# the iOS app
cd app && npm install
./scripts/sync-web.sh                      # build the sky page into app/sky
npx expo run:ios
```

`web/scripts/fetch-skydata.py` re-downloads the offline sky packs into `data/skydata`. `app/scripts/testflight.sh <build>` archives and uploads to TestFlight with an App Store Connect API key.

## Privacy

Nothing is collected. No accounts, no analytics, no tracking. Your location stays on the phone, except that a rounded latitude/longitude goes to Open-Meteo for the weather forecast (and to the place search if you search for a place). See the [privacy policy](https://open-apps-studio.github.io/starmap/privacy/).

## Contributing

Issues and pull requests are welcome. If something's wrong in the sky (a planet in the wrong place, a missing star, a wrong rise time), please include your location and the date/time you were looking at.

## License

AGPL-3.0, same as the engine it's built on. Data keeps its own licences, see [CREDITS.md](CREDITS.md).
