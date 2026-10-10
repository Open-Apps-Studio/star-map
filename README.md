# Star Map (prototype)

A free star map for iPhone: point your phone at the sky and see what's there.
Fun prototype for friends, built on the open-source
[Stellarium Web Engine](https://github.com/Stellarium/stellarium-web-engine)
(AGPL-3.0, vendored in `engine/` at upstream commit `15cd08a266a9fed1081bb5cd8fe62984943a9286`, with our build patches).

- `engine/` — Stellarium Web Engine (C → WebAssembly), sky data in `engine/apps/test-skydata`
- `web/` — the sky page that runs the engine (sensors, search, gestures)
- `app/` — Expo app that hosts the sky page in a WebView with native UI on top

This project is AGPL-3.0 because the engine is.
