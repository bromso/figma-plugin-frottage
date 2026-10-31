import { Button, Type } from "@repo/ui";
import "@repo/ui/styles.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunStatus } from "../capture-run";
import type { PopupMessage, Reply } from "../messages";
import { friendlyError, isRestrictedUrl } from "../page";

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const BUSY = new Set(["capturing", "packing", "saving"]);
const LABEL: Record<string, string> = {
  capturing: "Capturing the page…",
  packing: "Packing the file…",
  saving: "Saving the file…",
};

async function currentStatus(): Promise<RunStatus | null> {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (contexts.length === 0) return null;
    return await chrome.runtime.sendMessage({ target: "offscreen", type: "get-status" });
  } catch {
    return null;
  }
}

function Popup() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [restricted, setRestricted] = useState<boolean | null>(null);
  const [status, setStatus] = useState<RunStatus>({ state: "idle" });

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      setTabId(tab?.id ?? null);
      setRestricted(isRestrictedUrl(tab?.url));
    });
    // A run that finished while the popup was closed is shown once; the offscreen document
    // clears it when read.
    currentStatus().then((s) => {
      if (s && s.state !== "idle") setStatus(s);
    });
    const onMessage = (
      message: PopupMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (reply: { received: boolean }) => void
    ) => {
      if (message?.target !== "popup" || message.type !== "status") return;
      setStatus(message.status);
      sendResponse({ received: true });
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  async function capture() {
    if (tabId === null) return;
    setStatus({ state: "capturing" });
    try {
      const reply: Reply | undefined = await chrome.runtime.sendMessage({
        target: "sw",
        type: "start",
        tabId,
      });
      if (reply && !reply.ok) setStatus({ state: "error", message: reply.error });
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const busy = BUSY.has(status.state);

  return (
    <main className="flex w-[320px] flex-col gap-3 bg-background p-4 text-foreground">
      <Type as="h1" size="large" weight="bold">
        Frottage
      </Type>
      {restricted ? (
        <Type role="alert">This page can't be captured.</Type>
      ) : (
        <>
          <Type className="text-muted-foreground">
            Save the rendered page as a .frottage file, then open it in the Frottage Figma plugin.
          </Type>
          <Type size="xsmall" className="text-muted-foreground">
            This file contains the page's content, including anything visible in a logged-in
            session.
          </Type>
          <Button onClick={capture} disabled={busy || restricted === null || tabId === null}>
            {busy ? (LABEL[status.state] ?? "Working…") : "Capture this page"}
          </Button>
        </>
      )}
      <div aria-live="polite">
        {status.state === "saved" && <Type>Saved {status.filename} to your Downloads.</Type>}
        {status.state === "error" && (
          <Type role="alert" className="text-destructive">
            {friendlyError(status.message)}
          </Type>
        )}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found in popup.html");
createRoot(root).render(<Popup />);
