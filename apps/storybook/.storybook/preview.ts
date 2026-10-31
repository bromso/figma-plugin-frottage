import type { Preview } from "@storybook/react";
import "@repo/ui/styles.css";

const preview: Preview = {
  tags: ["autodocs"],
  globalTypes: {
    theme: {
      description: "Figma theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, context) => {
      const dark = context.globals.theme === "dark";
      document.documentElement.classList.toggle("dark", dark);
      return Story();
    },
  ],
  parameters: {
    viewport: {
      options: {
        figmaSmall: {
          name: "Figma Plugin Small (300x200)",
          styles: { width: "300px", height: "200px" },
        },
        figmaMedium: {
          name: "Figma Plugin Default (320x480)",
          styles: { width: "320px", height: "480px" },
        },
        figmaLarge: {
          name: "Figma Plugin Large (400x600)",
          styles: { width: "400px", height: "600px" },
        },
      },
    },
  },
};

export default preview;
