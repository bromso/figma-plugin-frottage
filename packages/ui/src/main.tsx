import { PLUGIN, UI } from "@repo/common/networkSides";
import { Networker } from "monorepo-networker";
import React from "react";
import ReactDOM from "react-dom/client";
import { UI_CHANNEL } from "./app.network";

async function bootstrap() {
  Networker.initialize(UI, UI_CHANNEL);

  UI_CHANNEL.emit(PLUGIN, "hello", ["Hey there, Figma!"]);

  const App = (await import("./app")).default;

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element #root not found in index.html");
  }
  const root = ReactDOM.createRoot(rootElement);

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
