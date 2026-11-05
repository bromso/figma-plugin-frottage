import { useEffect, useMemo, useRef, useState } from "react";
import { type ContentsChoice, ContentsSection } from "./import/contents";
import { FontTable } from "./import/font-table";
import {
  failuresHeading,
  type ImportPort,
  type ImportState,
  type ReviewDecision,
  runImports,
  type SetReport,
  type VersionResult,
} from "./import/import-flow";
import { OptionsSheet } from "./import/options";
import { Button, Progress, SectionTitle } from "./index";

type DoneState = Extract<ImportState, { step: "done" }>;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What the theme import did, as lines. Only a page imported with layers has any. `advise` adds the
 * no-theme line, which a device set's captures can't follow as worded.
 */
function themeLines({ report, theme }: Pick<VersionResult, "report" | "theme">, advise = true) {
  if (!theme) return [];
  const lines: string[] = [];
  const modes = report.themeModes ?? [];
  if (modes.length > 1) lines.push(`Color Mode: ${modes.join(", ")}`);
  else if (theme.source !== "site" && advise) {
    lines.push("No theme found in the stylesheet, so Color Mode has Light only.");
  }
  if (theme.inferred.length > 0) lines.push(`Inferred from use: ${theme.inferred.join(", ")}`);
  if (theme.twins > 0) {
    lines.push(`${theme.twins} colors are near twins of another and were kept separate.`);
  }
  const { raw } = report;
  if (raw && raw.colors + raw.radii + raw.spacing > 0) {
    lines.push(
      `Raw values left unbound: ${plural(raw.colors, "color")}, ${plural(raw.radii, "radius", "radii")}, ${raw.spacing} spacing`
    );
  }
  if (theme.modesDropped.length > 0) {
    lines.push(`This file allows fewer modes. Not created: ${theme.modesDropped.join(", ")}.`);
  }
  if (theme.variablesRenamed > 0) {
    lines.push(
      theme.variablesRenamed === 1
        ? "1 variable had changed values and was added as a new one."
        : `${theme.variablesRenamed} variables had changed values and were added as new ones.`
    );
  }
  if (theme.legacyCollections) {
    lines.push(
      "This file has collections from an earlier Frottage version. They were left as they are."
    );
  }
  return lines;
}

/** The counts of one version. */
function Report({
  state,
  headingRef,
  heading = "Import complete",
}: {
  state: VersionResult;
  headingRef?: React.Ref<HTMLParagraphElement>;
  heading?: string;
}) {
  const { report, failedOps, missingImages, rewrappedTexts, textDriftCount } = state;
  const rows: [string, number][] = [
    ["Layers", report.nodes],
    ["Text", report.texts],
    ["Images", report.images],
    ["Placeholders", report.placeholders],
  ];
  if (report.downscaledImages > 0) rows.push(["Images downscaled", report.downscaledImages]);
  if (failedOps > 0) rows.push(["Failed layers", failedOps]);
  if (missingImages > 0) rows.push(["Missing images", missingImages]);
  const { autoLayoutFrames, fallbackFrames, overrideFailures, tokenFailures } = state;
  if (state.componentsCreated > 0) rows.push(["Components", state.componentsCreated]);
  // The plan's count is of what should be there, which failed layers make untrue.
  const instances = failedOps > 0 ? state.instancesCreated : report.instances;
  if (instances > 0) rows.push(["Instances", instances]);
  if (state.hoverVariants > 0) rows.push(["Hover variants", state.hoverVariants]);
  if (autoLayoutFrames > 0) rows.push(["Auto layout frames", autoLayoutFrames]);
  if (fallbackFrames > 0) rows.push(["Frames without auto layout", fallbackFrames]);
  if (state.stylesCreated > 0) rows.push(["Styles created", state.stylesCreated]);
  if (state.stylesReused > 0) rows.push(["Styles reused", state.stylesReused]);
  if (state.variablesCreated > 0) rows.push(["Variables created", state.variablesCreated]);
  if (state.variablesReused > 0) rows.push(["Variables reused", state.variablesReused]);
  if (rewrappedTexts > 0) rows.push(["Text blocks that wrap differently", rewrappedTexts]);
  if (textDriftCount > 0) rows.push(["Text blocks that changed size", textDriftCount]);
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle ref={headingRef} tabIndex={-1} className="outline-none">
        {heading}
      </SectionTitle>
      <dl className="flex flex-col">
        {rows.map(([label, count]) => (
          <div key={label} className="flex h-6 items-center justify-between">
            <dt className="text-figma-text-secondary">{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      {themeLines(state).map((line) => (
        <p key={line} className="text-figma-text-secondary">
          {line}
        </p>
      ))}
      {overrideFailures > 0 && (
        <p className="text-figma-text-danger">
          {state.overrideFailuresInMains > 0 ? "At least " : ""}
          {overrideFailures} instance {overrideFailures === 1 ? "layer" : "layers"} could not be
          changed and {overrideFailures === 1 ? "shows" : "show"} the component's own content.
        </p>
      )}
      {state.layoutFailures > 0 && (
        <p className="text-figma-text-danger">
          The components could not be arranged, so some may overlap in their section.
        </p>
      )}
      {state.hoverFailures > 0 && (
        <p className="text-figma-text-danger">
          {state.hoverFailures} {state.hoverFailures === 1 ? "component" : "components"} could not
          get a Hover variant and {state.hoverFailures === 1 ? "stays" : "stay"} as imported.
        </p>
      )}
      {state.paintFailures > 0 && (
        <p className="text-figma-text-danger">
          Figma refused the fills or effects of {state.paintFailures}{" "}
          {state.paintFailures === 1 ? "layer" : "layers"}, which{" "}
          {state.paintFailures === 1 ? "stays" : "stay"} without them.
        </p>
      )}
      {state.resizedFallbacks > 0 && (
        <p className="text-figma-text-danger">
          {state.resizedFallbacks}{" "}
          {state.resizedFallbacks === 1 ? "instance was" : "instances were"} resized from a
          component that lost its auto layout, so the content may sit off.
        </p>
      )}
      {tokenFailures > 0 && (
        <p className="text-figma-text-danger">
          {tokenFailures} {tokenFailures === 1 ? "style or variable" : "styles or variables"} could
          not be created and {tokenFailures === 1 ? "was" : "were"} left out.
        </p>
      )}
      {report.substitutedFonts.length > 0 && (
        <div>
          <p className="font-medium">Substituted fonts</p>
          <ul className="text-figma-text-secondary">
            {report.substitutedFonts.map((f) => (
              <li key={`${f.from}>${f.to}`}>
                {f.from} replaced by {f.to}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.warnings.length > 0 && (
        <div>
          <p className="font-medium">Capture warnings</p>
          <ul className="text-figma-text-secondary">
            {report.warnings.map((w, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: warnings are a static list and may repeat
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** What the versions of a set share: its modes, and its tokens, which no one version owns. */
function SetSummary({ set }: { set: SetReport }) {
  const rows: [string, number][] = [];
  if (set.modes > 0) rows.push(["Modes", set.modes]);
  if (set.stylesCreated > 0) rows.push(["Styles created", set.stylesCreated]);
  if (set.stylesReused > 0) rows.push(["Styles reused", set.stylesReused]);
  if (set.variablesCreated > 0) rows.push(["Variables created", set.variablesCreated]);
  if (set.variablesReused > 0) rows.push(["Variables reused", set.variablesReused]);
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{set.name}</p>
      {rows.length > 0 && (
        <dl className="flex flex-col">
          {rows.map(([label, count]) => (
            <div key={label} className="flex h-6 items-center justify-between">
              <dt className="text-figma-text-secondary">{label}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
      )}
      {set.theme &&
        themeLines(set.theme, false).map((line) => (
          <p key={line} className="text-figma-text-secondary">
            {line}
          </p>
        ))}
      {set.modesDropped > 0 && (
        <p className="text-figma-text-danger">
          Figma gave {plural(set.modesDropped, "version")} no mode, so{" "}
          {plural(set.plainFrames, "frame")} kept plain values and{" "}
          {set.plainFrames === 1 ? "uses" : "use"} no variables.
        </p>
      )}
      {set.tokenFailures > 0 && (
        <p className="text-figma-text-danger">
          {plural(set.tokenFailures, "style or variable", "styles or variables")} could not be made
          or applied and {set.tokenFailures === 1 ? "was" : "were"} left out.
        </p>
      )}
      {set.layoutFailures > 0 && (
        <p className="text-figma-text-danger">
          The component sections could not be placed, so some may overlap.
        </p>
      )}
      {set.notes.length > 0 && (
        <ul className="text-figma-text-secondary">
          {set.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Several versions: a heading, the files that failed, each set, then one report per version. */
function VersionsReport({
  state,
  headingRef,
}: {
  state: DoneState;
  headingRef: React.Ref<HTMLParagraphElement>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle ref={headingRef} tabIndex={-1} className="outline-none">
        Import complete
      </SectionTitle>
      {state.failures.length > 0 && (
        <div role="alert">
          <p className="font-medium text-figma-text-danger">{failuresHeading(state.failures)}</p>
          <ul className="text-figma-text-secondary">
            {state.failures.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the same file name can fail twice
              <li key={`${i}:${f.name}`}>
                {f.name}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.sets.map((set, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two sets can share a page name
        <SetSummary key={`${i}:${set.name}`} set={set} />
      ))}
      {state.versions.map((v, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two versions can share a name and label
        <Report key={`${i}:${v.name}:${v.label}`} state={v} heading={`${v.label} · ${v.name}`} />
      ))}
    </div>
  );
}

/** Options and missing fonts, before anything is created. Import always works as it stands. */
function Review({
  state,
  onDecide,
}: {
  state: Extract<ImportState, { step: "review" }>;
  onDecide: (decision: ReviewDecision | null) => void;
}) {
  const [options, setOptions] = useState(state.options);
  const headingRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const [choices, setChoices] = useState<ReadonlyMap<string, string>>(new Map());
  const { contents } = state;
  const [picked, setPicked] = useState<ContentsChoice | null>(() =>
    contents
      ? {
          devices: contents.devices.map((d) => d.on),
          extras: contents.extras.map((e) => e.on),
          placement: contents.placement,
          themes: {
            light: contents.themes.light?.on ?? false,
            dark: contents.themes.dark?.on ?? false,
          },
          languages: contents.languages.map((l) => l.on),
        }
      : null
  );
  // The line and warnings follow the ticks; as shown at first until one changes.
  const themesChanged =
    picked !== null &&
    contents !== undefined &&
    (picked.themes.light !== (contents.themes.light?.on ?? false) ||
      picked.themes.dark !== (contents.themes.dark?.on ?? false));
  const languagesChanged =
    picked !== null &&
    contents !== undefined &&
    picked.languages.some((on, i) => on !== contents.languages[i]?.on);
  // The codes of the languages ticked; the current one always.
  const languages = useMemo(
    () =>
      contents?.languages
        .filter((l, i) => l.current || picked?.languages[i] !== false)
        .map((l) => l.code) ?? [],
    [contents, picked]
  );
  const summary = useMemo(() => {
    if (!contents || !picked) return null;
    const first = { collections: contents.collections, overLimit: contents.overLimit };
    const unchanged =
      picked.devices.every((on, i) => on === contents.devices[i]?.on) &&
      picked.extras.every((on, i) => on === contents.extras[i]?.on) &&
      !themesChanged &&
      !languagesChanged;
    return unchanged
      ? first
      : (contents.summarize?.(
          picked.devices,
          picked.extras,
          picked.themes,
          languagesChanged ? languages : undefined
        ) ?? first);
  }, [contents, picked, themesChanged, languagesChanged, languages]);
  // A device set always shows its contents, so the options wait behind a button unless asked for.
  const [showOptions, setShowOptions] = useState(
    !contents || contents.devices.length === 0 || state.optionsOpen === true
  );
  const noDevice = picked !== null && picked.devices.length > 0 && !picked.devices.some(Boolean);
  // A file's themes need one ticked; a file with no choice to make has no themes to tick.
  const noTheme = picked !== null && !picked.themes.light && !picked.themes.dark;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SectionTitle ref={headingRef} tabIndex={-1} className="outline-none">
        Import settings
      </SectionTitle>
      <div
        data-testid="review-scroll"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
      >
        {contents && picked && summary && (
          <ContentsSection
            contents={contents}
            choice={picked}
            summary={summary}
            onChange={setPicked}
          />
        )}
        {state.hostname && showOptions && (
          <p className="text-figma-text-secondary">Settings for {state.hostname}</p>
        )}
        {showOptions ? (
          <OptionsSheet options={options} onChange={setOptions} />
        ) : (
          <Button variant="secondary" className="self-start" onClick={() => setShowOptions(true)}>
            Options
          </Button>
        )}
        {state.missing.length > 0 && (
          <FontTable
            fonts={state.missing}
            families={state.families}
            choices={choices}
            onChoose={(family, choice) => setChoices((c) => new Map(c).set(family, choice))}
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onDecide(null)}>
          Cancel
        </Button>
        <Button
          disabled={noDevice || noTheme}
          aria-describedby={noTheme ? "themes-hint" : undefined}
          onClick={() =>
            onDecide({
              options,
              fonts: new Map(
                state.missing.map((m) => [m.family, choices.get(m.family) ?? m.choice])
              ),
              // Themes the user left alone are not a choice: the capture's own choice, or every
              // stylesheet mode, still applies.
              ...(picked
                ? {
                    contents: {
                      devices: picked.devices,
                      extras: picked.extras,
                      placement: picked.placement,
                      ...(themesChanged ? { themes: picked.themes } : {}),
                      ...(languagesChanged ? { languages } : {}),
                    },
                  }
                : {}),
            })
          }
        >
          Import
        </Button>
      </div>
    </div>
  );
}

/** The one screen: choose a .frottage file, watch it import, read the report. */
function App({ port }: { port?: ImportPort }) {
  const [state, setState] = useState<ImportState>({ step: "idle" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const decide = useRef<((d: ReviewDecision | null) => void) | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const working = state.step === "working";
  const abort = useRef<AbortController | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // A drop outside the drop area must not make Figma's iframe navigate to the file.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // The picker unmounts when an import finishes, so move focus to the outcome.
  useEffect(() => {
    if (state.step === "error") errorRef.current?.focus();
    if (state.step === "done") headingRef.current?.focus();
  }, [state.step]);

  async function start(files: File[]) {
    if (files.length === 0 || busy.current) return;
    busy.current = true;
    try {
      const target = port ?? (await import("./app.network")).channelImportPort;
      const forceReview = optionsOpen;
      setOptionsOpen(false);
      const controller = new AbortController();
      abort.current = controller;
      setCancelling(false);
      await runImports(
        files,
        target,
        setState,
        {
          forceReview,
          decide: () =>
            new Promise<ReviewDecision | null>((resolve) => {
              decide.current = resolve;
            }),
        },
        controller.signal
      );
    } finally {
      abort.current = null;
      setCancelling(false);
      busy.current = false;
    }
  }

  function reset() {
    setState({ step: "idle" });
  }

  const total = state.step === "working" ? state.total : 0;
  const percent = state.step === "working" && total > 0 ? (state.done / total) * 100 : 0;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto bg-background p-2 text-foreground">
      <SectionTitle>Import a Frottage capture</SectionTitle>

      <input
        ref={input}
        type="file"
        hidden
        aria-label="Choose .frottage files"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void start(files);
        }}
      />

      {(state.step === "idle" || state.step === "error") && (
        <fieldset
          aria-label="Drop area"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void start(Array.from(e.dataTransfer.files));
          }}
          className={`flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center ${
            dragging
              ? "border-figma-border-selected bg-figma-bg-selected"
              : "border-figma-border bg-figma-bg-secondary"
          }`}
        >
          <p className="text-figma-text-secondary">Drop one or more .frottage files here, or</p>
          <Button onClick={() => input.current?.click()}>Choose files…</Button>
          <Button
            variant="secondary"
            aria-pressed={optionsOpen}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            Options
          </Button>
          {optionsOpen && (
            <p className="text-figma-text-secondary">The options open when you choose a file.</p>
          )}
        </fieldset>
      )}

      {state.step === "error" && (
        <p
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="whitespace-pre-line text-figma-text-danger outline-none"
        >
          {state.message}
        </p>
      )}

      <p role="status" className="sr-only">
        {working ? "Importing" : state.step === "done" ? "Import finished" : ""}
      </p>

      {working && (
        <div className="flex flex-col gap-2">
          <p aria-hidden="true">
            {state.file.total > 1
              ? `${state.file.unit === "size" ? "Size" : "File"} ${state.file.index} of ${state.file.total}: `
              : ""}
            {total > 0 ? `Importing ${state.done} of ${total} layers` : "Reading the file"}
          </p>
          <Progress value={percent} aria-label="Import progress" />
          <Button
            variant="secondary"
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              abort.current?.abort();
            }}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      )}

      {state.step === "review" && (
        <Review
          state={state}
          onDecide={(decision) => {
            decide.current?.(decision);
            decide.current = null;
          }}
        />
      )}

      {state.step === "done" && (
        <>
          {state.versions.length > 1 || state.failures.length > 0 || state.sets.length > 0 ? (
            <VersionsReport state={state} headingRef={headingRef} />
          ) : (
            <Report state={state} headingRef={headingRef} />
          )}
          <Button variant="secondary" onClick={reset}>
            Import more files
          </Button>
        </>
      )}
    </div>
  );
}

export default App;
