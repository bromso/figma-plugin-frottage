import type { PageLanguage } from "@repo/capture-schema";
import { Button, Checkbox, Icon, Input, Label, Type } from "@repo/ui";
import "@repo/ui/styles.css";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunStatus } from "../capture-run";
import type { PopupMessage, Reply } from "../messages";
import {
  allowAccessAndRecapture,
  applyLanguages,
  applyProbe,
  BREAKPOINT_WAIT_MS,
  canCapture,
  captureCountLine,
  captureLabel,
  DEVICES,
  friendlyError,
  imageAdvice,
  initialThemes,
  isRestrictedUrl,
  leftOutLine,
  NO_DARK_HINT,
  nodeAdvice,
  otherOrigins,
  parseChoices,
  parseWidths,
  popupView,
  rerunRequest,
  themeHint,
  tickedLanguages,
  viewportAdvice,
  viewportStatusLabel,
  type WidthChoice,
} from "../page";
import { extrasLine, planWidths, type RunWidth } from "../plan-widths";

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

/** The origins among `origins` the extension can already reach. */
async function heldOrigins(origins: string[]): Promise<string[]> {
  const held = await Promise.all(
    origins.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => false))
  );
  return origins.filter((_, i) => held[i]);
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

  // Which themes to import; Dark starts unticked but can be ticked until the probe says the page has none.
  const [themes, setThemes] = useState(() => initialThemes(undefined).themes);
  const [darkEnabled, setDarkEnabled] = useState(true);
  // Set once the user ticks a box, so a late probe reply doesn't overwrite the choice.
  const touched = useRef(false);

  // The page's languages, when it has more than one; the current one is always ticked.
  const [languages, setLanguages] = useState<PageLanguage[]>([]);
  const [tickedCodes, setTickedCodes] = useState<string[]>([]);
  const touchedLanguages = useRef(false);
  const tickedRef = useRef<string[]>([]);
  tickedRef.current = tickedCodes;
  const [tabUrl, setTabUrl] = useState("");
  // Languages the last run left out because their site refused access.
  const [leftOut, setLeftOut] = useState<PageLanguage[]>([]);

  // The size for each device, remembered between opens.
  const [choices, setChoices] = useState<WidthChoice[]>(loadChoices);

  // The page's breakpoints, read once on open; none when the page can't be read.
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  // Capture waits for them, or for BREAKPOINT_WAIT_MS, so the extras they call for are planned.
  const [breakpointsRead, setBreakpointsRead] = useState(false);

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
    const giveUp = setTimeout(() => setBreakpointsRead(true), BREAKPOINT_WAIT_MS);
    chrome.tabs.query({ active: true, currentWindow: true }).then(
      ([tab]) => {
        setTabId(tab?.id ?? null);
        setTabUrl(tab?.url ?? "");
        const offLimits = isRestrictedUrl(tab?.url);
        setRestricted(offLimits);
        setTabRead(true);
        // The toolbar click that opened the popup granted `activeTab`. A refusal plans no extras.
        if (tab?.id !== undefined && !offLimits) {
          chrome.runtime.sendMessage({ target: "sw", type: "breakpoints", tabId: tab.id }).then(
            (reply?: Reply) => {
              if (reply?.ok && reply.breakpoints) setBreakpoints(reply.breakpoints);
              setThemes((cur) => applyProbe(cur, touched.current, reply).themes);
              setDarkEnabled(initialThemes(reply).darkEnabled);
              const found = applyLanguages(tickedRef.current, touchedLanguages.current, reply);
              setLanguages(found.languages);
              setTickedCodes(found.ticked);
              setBreakpointsRead(true);
            },
            () => {
              setThemes((cur) => applyProbe(cur, touched.current, undefined).themes);
              setDarkEnabled(initialThemes(undefined).darkEnabled);
              setBreakpointsRead(true);
            }
          );
        } else setBreakpointsRead(true);
      },
      () => {
        setTabRead(true);
        setBreakpointsRead(true);
      }
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
    return () => {
      clearTimeout(giveUp);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  // Whether Cancel was clicked.
  const [stopping, setStopping] = useState(false);
  const results = useRef<HTMLDivElement>(null);

  const devices = DEVICES.flatMap((device, index) => {
    const choice = choices[index];
    const [width] = choice.on ? parseWidths([choice.text]) : [];
    return width === undefined ? [] : [{ width, id: device.id, name: device.name }];
  });
  const plan = planWidths(devices, breakpoints);
  const wanted = plan.widths;
  const noThemeHint = themeHint(themes, darkEnabled);
  const extras = extrasLine(plan.extras);
  const chosenLanguages = tickedLanguages(languages, tickedCodes);
  const countLine = captureCountLine(devices.length, chosenLanguages.length, plan.extras.length);
  const captureTotal =
    chosenLanguages.length > 1
      ? devices.length * chosenLanguages.length + plan.extras.length
      : wanted.length;

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
    runWidths?: RunWidth[];
    collapseWrappers: boolean;
    themes?: { light: boolean; dark: boolean };
    languages?: PageLanguage[];
  }) {
    const {
      widths,
      runWidths,
      collapseWrappers,
      themes: askedThemes,
      languages: askedLanguages,
    } = request ?? {
      widths: wanted.map((w) => w.width),
      runWidths: wanted,
      collapseWrappers: false,
      themes,
      languages: chosenLanguages.length > 1 ? chosenLanguages : undefined,
    };
    // A re-run of a status from an older build has plain widths only.
    const asked: RunWidth[] = runWidths ?? widths.map((width) => ({ width }));
    if (tabId === null || asked.length === 0) return;
    // Asked first, so Chrome sees the click's user gesture; a refused site's languages are left out.
    let languagesToRun = askedLanguages;
    setLeftOut([]);
    if (!request && languagesToRun) {
      const origins = otherOrigins(languagesToRun, tabUrl);
      if (origins.length > 0) {
        const granted = await chrome.permissions.request({ origins }).catch(() => false);
        if (!granted) {
          const held = await heldOrigins(origins);
          const dropped = languagesToRun.filter((l) => {
            const [origin] = otherOrigins([l], tabUrl);
            return origin !== undefined && !held.includes(origin);
          });
          languagesToRun = languagesToRun.filter((l) => !dropped.includes(l));
          setLeftOut(dropped);
        }
      }
      if (languagesToRun.length < 2) languagesToRun = undefined;
    }
    const widest = asked.reduce((a, b) => (b.width > a.width ? b : a));
    setStopping(false);
    setDeclined(false);
    setStatus({
      state: "viewport",
      index: 1,
      total: asked.length,
      label: widest.device?.name ?? widest.breakpoint ?? String(widest.width),
    });
    try {
      const reply: Reply | undefined = await chrome.runtime.sendMessage({
        target: "sw",
        type: "viewport-start",
        tabId,
        ...(runWidths ? { runWidths } : { widths }),
        ...(collapseWrappers ? { collapseWrappers: true } : {}),
        ...(askedThemes ? { themes: askedThemes } : {}),
        ...(languagesToRun ? { languages: languagesToRun } : {}),
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
      {leftOut.map((l) => (
        <Type key={l.code} className="text-muted-foreground">
          {leftOutLine(l)}
        </Type>
      ))}
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
        {leftOut.map((l) => (
          <Type key={l.code} size="xsmall" className="text-muted-foreground">
            {leftOutLine(l)}
          </Type>
        ))}
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
        {extras && <Type className="text-muted-foreground">{extras}</Type>}
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
          <legend className="sr-only">Themes to import</legend>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="theme-light"
                checked={themes.light}
                onCheckedChange={(on) => {
                  touched.current = true;
                  setThemes((t) => ({ ...t, light: on === true }));
                }}
              />
              <Label htmlFor="theme-light">Light</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="theme-dark"
                checked={themes.dark}
                disabled={!darkEnabled}
                aria-describedby={darkEnabled ? undefined : "theme-dark-hint"}
                onCheckedChange={(on) => {
                  touched.current = true;
                  setThemes((t) => ({ ...t, dark: on === true }));
                }}
              />
              <Label htmlFor="theme-dark">Dark</Label>
            </div>
          </div>
          {!darkEnabled && (
            <Type id="theme-dark-hint" size="xsmall" className="text-muted-foreground">
              {NO_DARK_HINT}
            </Type>
          )}
          {noThemeHint && (
            <Type id="theme-none-hint" size="xsmall" className="text-muted-foreground">
              {noThemeHint}
            </Type>
          )}
        </fieldset>
        {languages.length > 1 && (
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">Languages to capture</legend>
            <Type size="xsmall" weight="bold">
              Languages
            </Type>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {languages.map((language) => (
                <div key={language.code} className="flex items-center gap-2">
                  <Checkbox
                    id={`language-${language.code}`}
                    checked={language.current || tickedCodes.includes(language.code)}
                    disabled={language.current}
                    onCheckedChange={(on) => {
                      touchedLanguages.current = true;
                      setTickedCodes((codes) =>
                        on === true
                          ? [...codes, language.code]
                          : codes.filter((c) => c !== language.code)
                      );
                    }}
                  />
                  <Label htmlFor={`language-${language.code}`}>{language.name}</Label>
                </div>
              ))}
            </div>
          </fieldset>
        )}
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
          aria-describedby={noThemeHint ? "theme-none-hint" : undefined}
          disabled={
            !canCapture({ restricted, tabId, sizes: wanted.length, breakpointsRead, themes })
          }
        >
          {captureLabel(captureTotal)}
        </Button>
        {countLine && (
          <Type size="xsmall" className="mt-2 text-muted-foreground">
            {countLine}
          </Type>
        )}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found in popup.html");
createRoot(root).render(<Popup />);
