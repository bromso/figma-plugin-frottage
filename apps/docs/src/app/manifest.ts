import type { MetadataRoute } from "next";
import { BASE } from "@/lib/base";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Figma Plugin Template Docs",
    short_name: "FPT Docs",
    description: "Build Figma plugins with React, Bun, TypeScript, and AI skills",
    start_url: `${BASE}/docs`,
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#a259ff",
    icons: [
      {
        src: `${BASE}/android-chrome-192x192.png`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: `${BASE}/android-chrome-512x512.png`,
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
