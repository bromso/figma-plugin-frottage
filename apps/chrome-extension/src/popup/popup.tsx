import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Type,
} from "@repo/ui";
import "@repo/ui/styles.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunStatus } from "../capture-run";
import type { PopupMessage, Reply } from "../messages";
import {
  allowAccessAndRecapture,
  devtoolsSteps,
  friendlyError,
  imageAdvice,
  isRestrictedUrl,
  LABEL_MAX,
  nodeAdvice,
  normaliseVersion,
  parseChoices,
  parseWidths,
  viewportAdvice,
  viewportStatusLabel,
  type WidthChoice,
} from "../page";

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

// Stable keys for the width rows, which are positional.
const VIEWPORT_ROWS = ["a", "b", "c", "d", "e"];
const IMAGE_ORIGINS = { origins: ["<all_urls>"] };

const BUSY = new Set(["capturing", "packing", "saving", "viewport"]);
const LABEL: Record<string, string> = {
  capturing: "Capturing the page…",
  packing: "Packing the file…",
  saving: "Saving the file…",
};

const CHOICES_KEY = "frottage-widths";

function loadChoices(): WidthChoice[] {
  try {
    return parseChoices(localStorage.getItem(CHOICES_KEY));
  } catch {
    return parseChoices(null);
  }
}

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
  // Set once a capture was made without wrappers, so it is not offered a second time.
  const [collapsed, setCollapsed] = useState(false);

  // The optional label that says which version of the page this file is.
  const [versionKind, setVersionKind] = useState("theme");
  const [versionLabel, setVersionLabel] = useState("");

  // The widths for a capture at several sizes, remembered between opens.
  const [choices, setChoices] = useState<WidthChoice[]>(loadChoices);

  // Whether the optional image permission is held; read when a capture finishes with blocked images.
  const [declined, setDeclined] = useState(false);
  const [accessHeld, setAccessHeld] = useState<boolean | null>(null);

  useEffect(() => {
    const blocked =
      status.state === "saved"
        ? status.blockedImages
        : status.state === "viewport-done"
          ? status.blockedImages
          : 0;
    if (blocked <= 0) return;
    chrome.permissions.contains(IMAGE_ORIGINS).then(setAccessHeld, () => setAccessHeld(null));
  }, [status]);

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

  async function capture(collapseWrappers = false) {
    if (tabId === null) return;
    setCollapsed(collapseWrappers);
    setDeclined(false);
    setStatus({ state: "capturing" });
    const version = normaliseVersion(versionKind, versionLabel);
    try {
      const reply: Reply | undefined = await chrome.runtime.sendMessage({
        target: "sw",
        type: "start",
        tabId,
        ...(collapseWrappers ? { collapseWrappers: true } : {}),
        ...(version ? { versionKind: version.kind, versionLabel: version.label } : {}),
      });
      if (reply && !reply.ok) setStatus({ state: "error", message: reply.error });
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const wanted = parseWidths(choices.filter((c) => c.on).map((c) => c.text));
  const steps = devtoolsSteps(wanted);

  function editChoice(index: number, change: Partial<WidthChoice>) {
    const next = choices.map((c, i) => (i === index ? { ...c, ...change } : c));
    setChoices(next);
    try {
      localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
    } catch {
      // Not remembered; the choices still work for this open.
    }
  }

  async function captureWidths() {
    if (tabId === null || wanted.length === 0) return;
    setDeclined(false);
    setStatus({
      state: "viewport",
      index: 1,
      total: wanted.length,
      label: String(wanted[0]),
    });
    try {
      const reply: Reply | undefined = await chrome.runtime.sendMessage({
        target: "sw",
        type: "viewport-start",
        tabId,
        widths: wanted,
      });
      if (reply && !reply.ok) setStatus({ state: "error", message: reply.error });
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function cancelRun() {
    chrome.runtime.sendMessage({ target: "offscreen", type: "viewport-cancel" }).catch(() => {});
  }

  // The request is the first thing the click does, so Chrome sees the user gesture.
  const allowImages = async () => {
    const granted = await allowAccessAndRecapture(
      () => chrome.permissions.request(IMAGE_ORIGINS),
      () => {
        setAccessHeld(true);
        void capture(collapsed);
      }
    );
    setDeclined(!granted);
  };

  const busy = BUSY.has(status.state);
  const advice = status.state === "saved" ? nodeAdvice(status.nodes, status.nodeLimit) : null;
  const images =
    (status.state === "saved" || status.state === "viewport-done") && accessHeld !== null
      ? imageAdvice(status.blockedImages, accessHeld)
      : null;
  const run = status.state === "viewport-done" ? viewportAdvice(status) : null;
  const runNodes = run?.nodeWarning ?? null;

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
          <Button
            onClick={() => capture()}
            disabled={busy || restricted === null || tabId === null}
          >
            {status.state === "viewport"
              ? viewportStatusLabel(status)
              : busy
                ? (LABEL[status.state] ?? "Working…")
                : "Capture this page"}
          </Button>
          {status.state === "viewport" && (
            <Button variant="secondary" onClick={cancelRun}>
              Cancel
            </Button>
          )}
          <details className="flex flex-col gap-2">
            <summary className="cursor-pointer">
              <Type as="span">Capture at several widths</Type>
            </summary>
            <fieldset className="mt-2 flex flex-col gap-2" disabled={busy}>
              <legend className="sr-only">Widths to capture</legend>
              {choices.map((choice, index) => (
                <div key={VIEWPORT_ROWS[index]} className="flex items-center gap-2">
                  <Checkbox
                    id={`width-on-${index}`}
                    checked={choice.on}
                    onCheckedChange={(on) => editChoice(index, { on: on === true })}
                    aria-label={`Capture at width ${choice.text}`}
                  />
                  <Input
                    inputMode="numeric"
                    className="w-[80px]"
                    value={choice.text}
                    maxLength={5}
                    aria-label={`Width ${index + 1} in pixels`}
                    aria-invalid={parseWidths([choice.text]).length === 0}
                    onChange={(e) => editChoice(index, { text: e.target.value })}
                  />
                  <Label htmlFor={`width-on-${index}`} className="text-muted-foreground">
                    px
                  </Label>
                </div>
              ))}
              <Type size="xsmall" className="text-muted-foreground">
                Widths from 320 to 3840. The window is resized for each one and put back after.
                Leave the window alone while it runs.
              </Type>
              {steps && (
                <div className="flex flex-col gap-1">
                  <Type size="xsmall">{steps[0]}</Type>
                  <ol className="list-decimal pl-4">
                    {steps.slice(1).map((step) => (
                      <li key={step}>
                        <Type size="xsmall" as="span">
                          {step}
                        </Type>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <Button
                variant="secondary"
                onClick={captureWidths}
                disabled={busy || tabId === null || wanted.length === 0}
              >
                Capture at these widths
              </Button>
            </fieldset>
          </details>
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className="sr-only">Label this capture (optional)</legend>
            <div className="flex gap-2">
              <div className="flex w-[110px] shrink-0 flex-col gap-1">
                <Label htmlFor="version-kind">Version</Label>
                <Select value={versionKind} onValueChange={setVersionKind}>
                  <SelectTrigger id="version-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="theme">Theme</SelectItem>
                    <SelectItem value="language">Language</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Label htmlFor="version-label">Label</Label>
                <Input
                  id="version-label"
                  value={versionLabel}
                  maxLength={LABEL_MAX}
                  placeholder={versionKind === "language" ? "Svenska" : "Dark"}
                  onChange={(e) => setVersionLabel(e.target.value)}
                />
              </div>
            </div>
            <Type size="xsmall" className="text-muted-foreground">
              Optional. Switch the site to that theme or language first, then capture. Leave the
              label empty for a plain capture.
            </Type>
          </fieldset>
        </>
      )}
      <div aria-live="polite">
        {status.state === "saved" && <Type>Saved {status.filename} to your Downloads.</Type>}
        {run && (
          <div className="flex flex-col gap-1">
            <Type>
              {run.saved.length > 0
                ? `Saved ${run.saved.length === 1 ? "1 file" : `${run.saved.length} files`} to your Downloads, at ${run.saved.join(", ")}.`
                : "No files were saved."}
            </Type>
            {run.stopped && <Type className="text-destructive">{run.stopped}</Type>}
            {run.mismatches.map((m) => (
              <Type key={m} className="text-muted-foreground">
                {m}
              </Type>
            ))}
            {run.steps && (
              <div className="flex flex-col gap-1">
                <Type size="xsmall">{run.steps[0]}</Type>
                <ol className="list-decimal pl-4">
                  {run.steps.slice(1).map((step) => (
                    <li key={step}>
                      <Type size="xsmall" as="span">
                        {step}
                      </Type>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {runNodes && <Type className="text-muted-foreground">{runNodes}</Type>}
          </div>
        )}
        {advice?.warning && <Type className="text-muted-foreground">{advice.warning}</Type>}
        {images && <Type className="text-muted-foreground">{images.message}</Type>}
        {declined && <Type>Image access wasn't granted.</Type>}
        {status.state === "error" && (
          <Type role="alert" className="text-destructive">
            {friendlyError(status.message)}
          </Type>
        )}
      </div>
      {images?.offerAccess && (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" disabled={busy} onClick={allowImages}>
            Allow image access
          </Button>
          <Type size="xsmall" className="text-muted-foreground">
            This lets Frottage download images from any site, only to put them in the file while you
            capture. The access stays until you remove it in Chrome's extension settings. Nothing is
            sent anywhere.
          </Type>
        </div>
      )}
      {advice?.offerCollapse && !collapsed && !busy && (
        <Button variant="secondary" onClick={() => capture(true)}>
          Capture again without wrappers
        </Button>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found in popup.html");
createRoot(root).render(<Popup />);
