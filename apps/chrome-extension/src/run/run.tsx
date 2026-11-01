import { Button, Type } from "@repo/ui";
import "@repo/ui/styles.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunStatus } from "../capture-run";
import type { PopupMessage } from "../messages";
import { viewportStatusLabel } from "../page";

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

function RunPage() {
  const [status, setStatus] = useState<RunStatus>({ state: "idle" });
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    // Never answers: a reply would reach the offscreen document ahead of the popup's, and a status
    // the popup saw would look unseen, or the reverse. No reply means "not shown to a popup".
    const onMessage = (message: PopupMessage) => {
      if (message?.target !== "popup" || message.type !== "status") return;
      setStatus(message.status);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  function cancel() {
    setStopping(true);
    chrome.runtime.sendMessage({ target: "offscreen", type: "viewport-cancel" }).catch(() => {});
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
      {status.state === "viewport-done" ? (
        <Type>{status.stopped ?? "The run is done."}</Type>
      ) : (
        <>
          <Type>
            {status.state === "viewport" ? viewportStatusLabel(status) : "Capturing the page…"}
          </Type>
          <Type className="text-muted-foreground">Leave the small window open.</Type>
          <Button variant="secondary" disabled={stopping} onClick={cancel}>
            {stopping ? "Stopping…" : "Cancel"}
          </Button>
        </>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<RunPage />);
