import { useRef, useState } from "react";
import { type ImportPort, type ImportState, runImport } from "./import/import-flow";
import { Button, Progress, SectionTitle } from "./index";

const MORE_THAN_ONE = "You dropped more than one file. Frottage imported the first one.";

function Report({ state }: { state: Extract<ImportState, { step: "done" }> }) {
  const { report, failedOps, missingImages } = state;
  const rows: [string, number][] = [
    ["Layers", report.nodes],
    ["Text", report.texts],
    ["Images", report.images],
    ["Placeholders", report.placeholders],
  ];
  if (failedOps > 0) rows.push(["Failed layers", failedOps]);
  if (missingImages > 0) rows.push(["Missing images", missingImages]);
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>Import complete</SectionTitle>
      <dl className="flex flex-col">
        {rows.map(([label, count]) => (
          <div key={label} className="flex h-6 items-center justify-between">
            <dt className="text-figma-text-secondary">{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
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

/** The one screen: choose a .frottage file, watch it import, read the report. */
function App({ port }: { port?: ImportPort }) {
  const [state, setState] = useState<ImportState>({ step: "idle" });
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const working = state.step === "working";

  async function start(files: File[]) {
    const file = files[0];
    if (!file || working) return;
    setNotice(files.length > 1 ? MORE_THAN_ONE : "");
    const target = port ?? (await import("./app.network")).channelImportPort;
    await runImport(file, target, setState);
  }

  const total = state.step === "working" ? state.total : 0;
  const percent = state.step === "working" && total > 0 ? (state.done / total) * 100 : 0;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto bg-background p-2 text-foreground">
      <SectionTitle>Import a Frottage capture</SectionTitle>

      <input
        ref={input}
        type="file"
        accept=".frottage"
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
          onDragLeave={() => setDragging(false)}
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
        </fieldset>
      )}

      {notice && <p className="text-figma-text-secondary">{notice}</p>}

      {state.step === "error" && (
        <p role="alert" className="text-figma-text-danger">
          {state.message}
        </p>
      )}

      {working && (
        <div role="status" className="flex flex-col gap-2">
          <p>{total > 0 ? `Importing ${state.done} of ${total} layers` : "Reading the file"}</p>
          <Progress value={percent} aria-label="Import progress" />
        </div>
      )}

      {state.step === "done" && (
        <>
          <Report state={state} />
          <Button variant="secondary" onClick={() => setState({ step: "idle" })}>
            Import another file
          </Button>
        </>
      )}
    </div>
  );
}

export default App;
