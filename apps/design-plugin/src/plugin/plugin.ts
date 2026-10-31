import { PLUGIN, UI } from "@repo/common/networkSides";
import { Networker } from "monorepo-networker";
import { PLUGIN_CHANNEL } from "./plugin.network";

async function bootstrap() {
  Networker.initialize(PLUGIN, PLUGIN_CHANNEL);

  figma.showUI(__html__, {
    width: 320,
    height: 480,
    themeColors: true,
    title: "Frottage",
  });

  console.log("Bootstrapped @", Networker.getCurrentSide().name);

  PLUGIN_CHANNEL.emit(UI, "hello", ["Hey there, UI!"]);
}

bootstrap();
