# Credits

Star Map stands on a lot of other people's work. Code is AGPL-3.0 (see [LICENSE](LICENSE)); everything below keeps its own licence.

## Code

| What | Licence | Notes |
| --- | --- | --- |
| [Stellarium Web Engine](https://github.com/Stellarium/stellarium-web-engine) by Stellarium Labs | AGPL-3.0 | Vendored in `engine/`, with our patches. Its bundled libraries (ERFA, zlib, zstd, stb, nanovg, md4c, libwebp, inih, uthash, json-parser, libtess2) keep their own licences, see `engine/ext_src`. |
| [three.js](https://threejs.org) | MIT | 3D planet and spacecraft views. |
| [Material Design Icons](https://pictogrammers.com/library/mdi/) | Apache-2.0 | UI icons. |
| [Expo](https://expo.dev), [React Native](https://reactnative.dev), [react-native-webview](https://github.com/react-native-webview/react-native-webview) | MIT | The iOS app shell. |

## Sky data

| What | Source | Licence / terms |
| --- | --- | --- |
| Stars (Hipparcos, Tycho-2, Gaia DR3 beyond magnitude 8) | ESA, packaged by the Stellarium project | Gaia: CC BY-SA 3.0 IGO. Hipparcos/Tycho: ESA, free for use with credit. |
| Deep-sky catalogue, sky cultures, landscapes, star names | [Stellarium](https://stellarium.org) and the authors of each sky culture and landscape | Mostly CC BY-SA 4.0 / GPL; each sky culture lists its own authors and references in its `index.json`. |
| Sky photos (Digitized Sky Survey) | STScI, via [CDS hips2fits](https://alasky.cds.unistra.fr/hips-image-services/hips2fits) and Stellarium's HiPS | DSS: STScI/NASA, free for non-commercial use with credit. |
| Satellite orbits | [CelesTrak](https://celestrak.org), [SatNOGS DB](https://db.satnogs.org) (Space-Track data) | Public. |
| Comets and asteroids | [IAU Minor Planet Center](https://minorplanetcenter.net) | Public. |
| Meteor showers | IAU Meteor Data Center, via Stellarium | Public. |

## Images, models, sound

| What | Source | Licence |
| --- | --- | --- |
| Planet maps (3D view, icons, planet surfaces in the sky) | [Solar System Scope](https://www.solarsystemscope.com/textures/), based on NASA imagery | CC BY 4.0 |
| ISS and Hubble 3D models | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | Public domain |
| Ambient soundtrack | Generated for Star Map with Google Lyria 2 | Made for this app |

## Online services

| What | Service | Terms |
| --- | --- | --- |
| Weather forecast | [Open-Meteo](https://open-meteo.com) | CC BY 4.0 |
| Place search | [Photon](https://photon.komoot.io) and [Nominatim](https://nominatim.org), OpenStreetMap data | ODbL |
| Object descriptions | [Wikipedia](https://www.wikipedia.org) REST API | CC BY-SA 4.0 |

Thanks to all of them, and especially to Stellarium Labs for open-sourcing the engine.
