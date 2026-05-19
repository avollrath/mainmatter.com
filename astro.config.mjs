import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

import { renderSite } from "./astro/lib/site-renderer.mjs";

export default defineConfig({
  integrations: [
    {
      name: "mainmatter-static-renderer",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          await renderSite({ outDir: fileURLToPath(dir) });
        },
      },
    },
  ],
  outDir: "./dist",
  publicDir: "./static",
  output: "static",
  srcDir: "./astro",
});
