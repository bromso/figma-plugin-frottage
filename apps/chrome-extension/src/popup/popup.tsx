import {
  Button,
  Checkbox,
  Icon,
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
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunStatus } from "../capture-run";
import type { PopupMessage, Reply } from "../messages";
import {
  allowAccessAndRecapture,
  captureLabel,
  DEVICES,
  friendlyError,
  imageAdvice,
  isRestrictedUrl,
  LABEL_MAX,
  nodeAdvice,
  normaliseVersion,
  parseChoices,
  parseWidths,
  popupView,
  rerunRequest,
  viewportAdvice,
  viewportStatusLabel,
  type WidthChoice,
} from "../page";

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const IMAGE_ORIGINS = { origins: ["<all_urls>"] };

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
  // Set once both the tab and the run's status have been read, so no list flashes before a run.
  const [tabRead, setTabRead] = useState(false);
  const [statusRead, setStatusRead] = useState(false);

  // The optional label that says which version of the page this file is.
  const [versionKind, setVersionKind] = useState("theme");
  const [versionLabel, setVersionLabel] = useState("");

  // The size for each device, remembered between opens.
  const [choices, setChoices] = useState<WidthChoice[]>(loadChoices);

  // Whether the optional image permission is held; read when a run finishes with blocked images.
  const [declined, setDeclined] = useState(false);
  const [accessHeld, setAccessHeld] = useState<boolean | null>(null);

  useEffect(() => {
    if (status.state !== "viewport-done" || status.blockedImages <= 0) return;
    chrome.permissions.contains(IMAGE_ORIGINS).then(setAccessHeld, () => setAccessHeld(null));
  }, [status]);

  useEffect(() => {
    // The badge says a run ended; opening the popup is the look it asked for.
    chrome.action.setBadgeText({ text: "" }).catch(() => {});
    chrome.tabs.query({ active: true, currentWindow: true }).then(
      ([tab]) => {
        setTabId(tab?.id ?? null);
        setRestricted(isRestrictedUrl(tab?.url));
        setTabRead(true);
      },
      () => setTabRead(true)
    );
    // A run that is going, or that finished while the popup was closed, is shown; the offscreen
    // document clears a finished one when read.
    currentStatus().then((s) => {
      if (s && s.state !== "idle") setStatus(s);
      setStatusRead(true);
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

  // Whether Cancel was clicked.
  const [stopping, setStopping] = useState(false);
  const results = useRef<HTMLDivElement>(null);

  const wanted = parseWidths(choices.filter((c) => c.on).map((c) => c.text));

  function editChoice(index: number, change: Partial<WidthChoice>) {
    const next = choices.map((c, i) => (i === index ? { ...c, ...change } : c));
    setChoices(next);
    try {
      localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
    } catch {
      // Not remembered; the choices still work for this open.
    }
  }

  async function captureWidths(request?: {
    widths: number[];
    collapseWrappers: boolean;
    versionLabel: string;
  }) {
    const version = normaliseVersion(versionKind, versionLabel);
    const {
      widths,
      collapseWrappers,
      versionLabel: label,
    } = request ?? {
      widths: wanted,
      collapseWrappers: false,
      versionLabel: version?.label ?? "",
    };
    if (tabId === null || widths.length === 0) return;
    setStopping(false);
    setDeclined(false);
    setStatus({
      state: "viewport",
      index: 1,
      total: widths.length,
      label: String(widths[0]),
    });
    try {
      const reply: Reply | undefined = await chrome.runtime.sendMessage({
        target: "sw",
        type: "viewport-start",
        tabId,
        widths,
        ...(collapseWrappers ? { collapseWrappers: true } : {}),
        ...(label ? { versionLabel: label } : {}),
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
    setStopping(true);
    chrome.runtime.sendMessage({ target: "offscreen", type: "viewport-cancel" }).catch(() => {});
  }

  // The request is the first thing the click does, so Chrome sees the user gesture.
  const allowImages = async () => {
    const granted = await allowAccessAndRecapture(
      () => chrome.permissions.request(IMAGE_ORIGINS),
      () => {
        setAccessHeld(true);
        // The run is asked again as it was, so the file gets its images.
        if (status.state === "viewport-done") void captureWidths(rerunRequest(status));
      }
    );
    setDeclined(!granted);
  };

  const view = popupView(status, restricted);
  const ready = tabRead && statusRead;
  const finishedRun = status.state === "viewport-done";
  const offerShown = finishedRun && accessHeld === false && status.blockedImages > 0;
  useEffect(() => {
    if (finishedRun || offerShown) results.current?.scrollIntoView?.({ block: "nearest" });
  }, [finishedRun, offerShown]);
  const run = status.state === "viewport-done" ? viewportAdvice(status) : null;
  const offerCollapse =
    status.state === "viewport-done" &&
    nodeAdvice(status.nodes, status.nodeLimit).offerCollapse &&
    !status.request.collapseWrappers;
  const images =
    status.state === "viewport-done" && accessHeld !== null
      ? imageAdvice(status.blockedImages, accessHeld)
      : null;
  const badTick = choices.some((c) => c.on && parseWidths([c.text]).length === 0);

  const outcome = (
    <div aria-live="polite" ref={results} className="flex flex-col gap-1">
      {run && (
        <>
          <Type>{run.summary}</Type>
          {run.stopped && <Type className="text-destructive">{run.stopped}</Type>}
          {run.skipped.map((line) => (
            <Type key={line} className="text-muted-foreground">
              {line}
            </Type>
          ))}
          {run.mismatches.map((m) => (
            <Type key={m} className="text-muted-foreground">
              {m}
            </Type>
          ))}
          {run.nodeWarning && <Type className="text-muted-foreground">{run.nodeWarning}</Type>}
        </>
      )}
      {images && <Type className="text-muted-foreground">{images.message}</Type>}
      {declined && <Type>Image access wasn't granted.</Type>}
      {status.state === "error" && (
        <Type role="alert" className="text-destructive">
          {friendlyError(status.message)}
        </Type>
      )}
    </div>
  );

  const heading = (
    <Type as="h1" size="large" weight="bold">
      Frottage
    </Type>
  );

  if (view === "run" && status.state === "viewport") {
    return (
      <main className="flex w-[320px] flex-col gap-3 bg-background p-4 text-foreground">
        {heading}
        <Type role="status">{viewportStatusLabel(status)}</Type>
        <Type size="xsmall" className="text-muted-foreground">
          Leave the small window open.
        </Type>
        <Button variant="secondary" disabled={stopping} onClick={cancelRun}>
          {stopping ? "Stopping…" : "Cancel"}
        </Button>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="flex w-[320px] flex-col gap-3 bg-background p-4 text-foreground">
        {heading}
      </main>
    );
  }

  if (view === "restricted") {
    return (
      <main className="flex w-[320px] flex-col gap-3 bg-background p-4 text-foreground">
        {heading}
        <Type role="alert">This page can't be captured.</Type>
        {outcome}
      </main>
    );
  }

  return (
    <main className="flex max-h-[600px] w-[320px] flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {heading}
        <Type className="text-muted-foreground">
          Save the page at each ticked size as one .frottage file, then open it in the Frottage
          Figma plugin.
        </Type>
        <Type size="xsmall" className="text-muted-foreground">
          This file contains the page's content, including anything visible in a logged-in session.
        </Type>
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="sr-only">Sizes to capture</legend>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-figma-bg-secondary">
            {DEVICES.map((device, index) => {
              const choice = choices[index];
              const invalid = choice.on && parseWidths([choice.text]).length === 0;
              return (
                <label
                  key={device.id}
                  htmlFor={`size-on-${device.id}`}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5"
                >
                  <Icon
                    name={device.icon}
                    className={device.rotate ? "shrink-0 rotate-90" : "shrink-0"}
                  />
                  <Type as="span" className="min-w-0 flex-1 truncate">
                    {device.name}
                  </Type>
                  <Input
                    inputMode="numeric"
                    className="w-[64px] shrink-0 text-right tabular-nums"
                    value={choice.text}
                    maxLength={5}
                    aria-label={`${device.name} width in pixels`}
                    aria-invalid={invalid}
                    onChange={(e) => editChoice(index, { text: e.target.value })}
                  />
                  <Checkbox
                    id={`size-on-${device.id}`}
                    checked={choice.on}
                    onCheckedChange={(on) => editChoice(index, { on: on === true })}
                    aria-label={`Capture ${device.name}`}
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
        <Type size="xsmall" className="text-muted-foreground">
          Widths from 120 to 3840. Your tab moves to a small window for each size, then comes back.
          Leave the window alone while it runs.
        </Type>
        {badTick && (
          <Type size="xsmall" className="text-destructive">
            A ticked size with no width from 120 to 3840 is skipped.
          </Type>
        )}
        <fieldset className="flex flex-col gap-2 border-0 p-0">
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
            Optional. Switch the site to that theme or language first, then capture. Leave the label
            empty for a plain capture.
          </Type>
        </fieldset>
        {outcome}
        {images?.offerAccess && (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={allowImages}>
              Allow image access
            </Button>
            <Type size="xsmall" className="text-muted-foreground">
              The sizes will be captured again, and a new file saved. This lets Frottage download
              images from any site, only to put them in the file while you capture. The access stays
              until you remove it in Chrome's extension settings. Nothing is sent anywhere.
            </Type>
          </div>
        )}
        {offerCollapse && (
          <Button
            variant="secondary"
            onClick={() =>
              status.state === "viewport-done" && captureWidths(rerunRequest(status, true))
            }
          >
            Capture again without wrappers
          </Button>
        )}
      </div>
      <div className="sticky bottom-0 border-t border-border bg-background p-4">
        <Button
          className="w-full"
          onClick={() => captureWidths()}
          disabled={restricted === null || tabId === null || wanted.length === 0}
        >
          {captureLabel(wanted.length)}
        </Button>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found in popup.html");
createRoot(root).render(<Popup />);
