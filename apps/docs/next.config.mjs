import { createMDX } from "fumadocs-mdx/next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  images: { unoptimized: true },
  ...(isGitHubPages && {
    output: "export",
    basePath: "/figma-plugin-template",
  }),
};

const withMDX = createMDX();

export default withMDX(config);
