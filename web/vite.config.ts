import { defineConfig } from "vite";

// Relative base so the built page also works from file:// inside the app's WebView.
export default defineConfig({ base: "./", build: { target: "es2020", assetsInlineLimit: 0 } });
