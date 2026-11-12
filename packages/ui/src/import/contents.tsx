import { useId } from "react";
import { Checkbox, Label, RadioGroup, RadioGroupItem } from "../index";
import type { ContentsSummary, Placement, ReviewContents, ThemeChoice } from "./import-flow";

/** The user's ticks, one per device, one per extra and one per language, and where the frames go. */
export type ContentsChoice = {
  devices: boolean[];
  extras: boolean[];
  placement: Placement;
  themes: ThemeChoice;
  languages: boolean[];
};

function TickRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex h-6 items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

function PlacementRow({ value, label }: { value: Placement; label: string }) {
  const id = useId();
  return (
    <div className="flex h-6 items-center gap-2">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

/** A device's name and width; a capture with no device data is named by its width alone. */
const deviceLabel = ({ name, width }: { name: string; width: number }) =>
  name === String(width) ? name : `${name} ${width}`;

/** A breakpoint's name and width; a name that already holds its width (`min 576`) stands alone. */
const breakpointLabel = ({ breakpoint, width }: { breakpoint: string; width: number }) =>
  breakpoint === `min ${width}` ? breakpoint : `${breakpoint} ${width}`;

/** "What's in this file": a device set's captures to tick, what they make, and where it goes. */
export function ContentsSection({
  contents,
  choice,
  summary,
  onChange,
}: {
  contents: ReviewContents;
  choice: ContentsChoice;
  summary: ContentsSummary;
  onChange: (choice: ContentsChoice) => void;
}) {
  const tick = (list: boolean[], at: number, value: boolean) =>
    list.map((on, i) => (i === at ? value : on));
  return (
    <div className="flex flex-col gap-1">
      <p className="flex h-6 items-center font-semibold text-figma-text-secondary">
        What's in this file
      </p>
      {contents.devices.length > 0 && (
        <fieldset aria-label="Devices" className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <p className="flex h-6 items-center text-figma-text-secondary">Devices</p>
          {contents.devices.map((device, i) => (
            <TickRow
              // biome-ignore lint/suspicious/noArrayIndexKey: two devices can share a name and width
              key={`d${i}`}
              label={deviceLabel(device)}
              checked={choice.devices[i] ?? true}
              onChange={(on) => onChange({ ...choice, devices: tick(choice.devices, i, on) })}
            />
          ))}
        </fieldset>
      )}
      {contents.extras.length > 0 && (
        <fieldset aria-label="Breakpoints" className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <p className="flex h-6 items-center text-figma-text-secondary">Breakpoints</p>
          {contents.extras.map((extra, i) => (
            <TickRow
              // biome-ignore lint/suspicious/noArrayIndexKey: two extras can share a breakpoint
              key={`e${i}`}
              label={breakpointLabel(extra)}
              checked={choice.extras[i] ?? true}
              onChange={(on) => onChange({ ...choice, extras: tick(choice.extras, i, on) })}
            />
          ))}
          <p className="text-figma-text-secondary">
            Breakpoint captures make no frames. They give the Breakpoint values.
          </p>
        </fieldset>
      )}
      {(contents.themes.light || contents.themes.dark) && (
        <fieldset aria-label="Themes" className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <p className="flex h-6 items-center text-figma-text-secondary">Themes</p>
          {contents.themes.light && (
            <TickRow
              label="Light"
              checked={choice.themes.light}
              onChange={(on) => onChange({ ...choice, themes: { ...choice.themes, light: on } })}
            />
          )}
          {contents.themes.dark && (
            <TickRow
              label="Dark"
              checked={choice.themes.dark}
              onChange={(on) => onChange({ ...choice, themes: { ...choice.themes, dark: on } })}
            />
          )}
          {!choice.themes.light && !choice.themes.dark && (
            <p id="themes-hint" className="text-figma-text-danger">
              Tick Light, Dark or both.
            </p>
          )}
        </fieldset>
      )}
      {contents.languages.length > 1 && (
        <fieldset aria-label="Languages" className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <p className="flex h-6 items-center text-figma-text-secondary">Languages</p>
          {contents.languages.map((language, i) => (
            <TickRow
              key={language.code}
              label={language.name}
              // The page's own language makes the frames, so it is always imported.
              checked={language.current || (choice.languages[i] ?? true)}
              disabled={language.current}
              onChange={(on) => onChange({ ...choice, languages: tick(choice.languages, i, on) })}
            />
          ))}
        </fieldset>
      )}
      {summary.collections && <p>{summary.collections}</p>}
      {summary.components && <p>{summary.components}</p>}
      {summary.overLimit.map((line) => (
        <p key={line} className="text-figma-text-danger">
          {line}
        </p>
      ))}
      {contents.devices.length > 0 && (
        <RadioGroup
          aria-label="Where it goes"
          value={choice.placement}
          onValueChange={(value) =>
            onChange({
              ...choice,
              placement: value === "current-page" ? "current-page" : "new-page",
            })
          }
        >
          <PlacementRow value="new-page" label="New page" />
          <PlacementRow value="current-page" label="Current page" />
        </RadioGroup>
      )}
    </div>
  );
}
