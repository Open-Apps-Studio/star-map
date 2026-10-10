import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained index.html (JS + CSS inlined) so the iOS app can load
// it from file:// inside a WebView: no module fetches, no server needed.
// The engine script and sky data stay as plain files next to it.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: { target: "es2020" },
});
