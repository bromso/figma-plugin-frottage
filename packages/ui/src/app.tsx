import { useEffect, useRef, useState } from "react";
import { FontTable } from "./import/font-table";
import {
  type ImportPort,
  type ImportState,
  type ReviewDecision,
  runImport,
} from "./import/import-flow";
import { OptionsSheet } from "./import/options";
import { Button, Progress, SectionTitle } from "./index";

const MORE_THAN_ONE = "You dropped more than one file. Frottage imported the first one.";

function Report({
  state,
  notice,
  headingRef,
}: {
  state: Extract<ImportState, { step: "done" }>;
  notice: string;
  headingRef: React.Ref<HTMLParagraphElement>;
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
  if (report.instances > 0) rows.push(["Instances", report.instances]);
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
        Import complete
      </SectionTitle>
      {notice && <p className="text-figma-text-secondary">{notice}</p>}
      <dl className="flex flex-col">
        {rows.map(([label, count]) => (
          <div key={label} className="flex h-6 items-center justify-between">
            <dt className="text-figma-text-secondary">{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      {overrideFailures > 0 && (
        <p className="text-figma-text-danger">
          {overrideFailures} instance {overrideFailures === 1 ? "layer" : "layers"} could not be
          changed and {overrideFailures === 1 ? "shows" : "show"} the component's own content.
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
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SectionTitle ref={headingRef} tabIndex={-1} className="outline-none">
        Import settings
      </SectionTitle>
      <div
        data-testid="review-scroll"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
      >
        {state.hostname && (
          <p className="text-figma-text-secondary">Settings for {state.hostname}</p>
        )}
        <OptionsSheet options={options} onChange={setOptions} />
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
          onClick={() =>
            onDecide({
              options,
              fonts: new Map(
                state.missing.map((m) => [m.family, choices.get(m.family) ?? m.choice])
              ),
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
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const decide = useRef<((d: ReviewDecision | null) => void) | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const working = state.step === "working";

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
    const file = files[0];
    if (!file || busy.current) return;
    busy.current = true;
    try {
      setNotice(files.length > 1 ? MORE_THAN_ONE : "");
      const target = port ?? (await import("./app.network")).channelImportPort;
      const forceReview = optionsOpen;
      setOptionsOpen(false);
      await runImport(file, target, setState, {
        forceReview,
        decide: () =>
          new Promise<ReviewDecision | null>((resolve) => {
            decide.current = resolve;
          }),
      });
    } finally {
      busy.current = false;
    }
  }

  function reset() {
    setNotice("");
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
        aria-label="Choose a .frottage file"
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
          <p className="text-figma-text-secondary">Drop a .frottage file here, or</p>
          <Button onClick={() => input.current?.click()}>Choose a file…</Button>
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

      {notice && state.step !== "working" && state.step !== "done" && (
        <p className="text-figma-text-secondary">{notice}</p>
      )}

      {state.step === "error" && (
        <p
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="text-figma-text-danger outline-none"
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
            {total > 0 ? `Importing ${state.done} of ${total} layers` : "Reading the file"}
          </p>
          <Progress value={percent} aria-label="Import progress" />
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
          <Report state={state} notice={notice} headingRef={headingRef} />
          <Button variant="secondary" onClick={reset}>
            Import another file
          </Button>
        </>
      )}
    </div>
  );
}

export default App;
