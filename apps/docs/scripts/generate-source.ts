// Generates `.source/` from source.config.ts so `tsc` can resolve
// `../../.source/server` without running `next build` or `next dev`.
import { postInstall } from "fumadocs-mdx/next";

await postInstall({ configPath: "source.config.ts" });
