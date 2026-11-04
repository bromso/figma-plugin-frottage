import { useId } from "react";
import { Checkbox, Label, RadioGroup, RadioGroupItem } from "../index";
import type { ContentsSummary, Placement, ReviewContents } from "./import-flow";

/** The user's ticks, one per device and one per extra, and where the frames go. */
export type ContentsChoice = { devices: boolean[]; extras: boolean[]; placement: Placement };

function TickRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex h-6 items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
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
      {contents.devices.map((device, i) => (
        <TickRow
          // biome-ignore lint/suspicious/noArrayIndexKey: two devices can share a name and width
          key={`d${i}`}
          label={deviceLabel(device)}
          checked={choice.devices[i] ?? true}
          onChange={(on) => onChange({ ...choice, devices: tick(choice.devices, i, on) })}
        />
      ))}
      {contents.extras.map((extra, i) => (
        <TickRow
          // biome-ignore lint/suspicious/noArrayIndexKey: two extras can share a breakpoint
          key={`e${i}`}
          label={`${extra.breakpoint} breakpoint ${extra.width}`}
          checked={choice.extras[i] ?? true}
          onChange={(on) => onChange({ ...choice, extras: tick(choice.extras, i, on) })}
        />
      ))}
      {contents.extras.length > 0 && (
        <p className="text-figma-text-secondary">
          Breakpoint captures make no frames. They give the Breakpoint values.
        </p>
      )}
      {summary.collections && <p>{summary.collections}</p>}
      {summary.overLimit.map((line) => (
        <p key={line} className="text-figma-text-danger">
          {line}
        </p>
      ))}
      <RadioGroup
        aria-label="Where it goes"
        value={choice.placement}
        onValueChange={(value) =>
          onChange({ ...choice, placement: value === "current-page" ? "current-page" : "new-page" })
        }
      >
        <PlacementRow value="new-page" label="New page" />
        <PlacementRow value="current-page" label="Current page" />
      </RadioGroup>
    </div>
  );
}
