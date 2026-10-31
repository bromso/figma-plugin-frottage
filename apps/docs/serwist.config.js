// @ts-check
import { serwist } from "@serwist/next/config";

// `next build` copies `public/` into `out/` before `serwist build` runs,
// so the static export needs the worker written straight into `out/`.
const isGitHubPages = process.env.GITHUB_PAGES === "true";

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: isGitHubPages ? "out/sw.js" : "public/sw.js",
  // A worker left in `public/` by an earlier local build must not be precached
  // as if it were a static asset.
  globIgnores: ["public/sw.js", "public/sw.js.map"],
});
