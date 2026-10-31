import { PLUGIN, UI } from "@repo/common/networkSides";
import { Networker } from "monorepo-networker";
import { PLUGIN_CHANNEL } from "./plugin.network";

async function bootstrap() {
  Networker.initialize(PLUGIN, PLUGIN_CHANNEL);

  if (figma.editorType === "figma") {
    figma.showUI(__html__, {
      width: 320,
      height: 480,
      themeColors: true,
      title: "My Figma Plugin!",
    });
  } else if (figma.editorType === "figjam") {
    figma.showUI(__html__, {
      width: 320,
      height: 480,
      themeColors: true,
      title: "My FigJam Plugin!",
    });
  }

  console.log("Bootstrapped @", Networker.getCurrentSide().name);

  PLUGIN_CHANNEL.emit(UI, "hello", ["Hey there, UI!"]);

  setInterval(() => PLUGIN_CHANNEL.emit(UI, "ping", []), 5000);
}

bootstrap();
