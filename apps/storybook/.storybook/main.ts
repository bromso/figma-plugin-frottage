import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { mergeConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  async viteFinal(config) {
    return mergeConfig(config, {
      plugins: [tailwindcss()],
      base: process.env.GITHUB_PAGES === "true" ? "/figma-plugin-template/storybook/" : "/",
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "../../../packages/ui/src"),
        },
      },
      build: {
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
          output: {
            manualChunks(id: string) {
              if (id.includes("node_modules")) {
                if (id.includes("react-dom")) return "vendor-react-dom";
                if (id.includes("radix-ui") || id.includes("@radix-ui")) return "vendor-radix";
                if (id.includes("@storybook")) return "vendor-storybook";
              }
            },
          },
        },
      },
    });
  },
};

export default config;
