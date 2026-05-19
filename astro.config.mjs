import { defineConfig } from "astro/config";

export default defineConfig({
  outDir: "./dist",
  publicDir: "./static",
  output: "static",
  srcDir: "./astro",
});
