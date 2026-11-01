import type { ImportOptions } from "@repo/figma-mapper";
import { useId } from "react";
import { Label, Switch } from "../index";

type Row = { key: keyof ImportOptions; label: string };

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Options",
    rows: [
      { key: "autoLayout", label: "Auto layout" },
      { key: "htmlNames", label: "HTML layer names" },
    ],
  },
  {
    title: "Enhancements",
    rows: [
      { key: "tokens", label: "Create styles and variables" },
      { key: "useLocalStyles", label: "Use existing local styles" },
      { key: "hyperlinks", label: "Hyperlinks" },
    ],
  },
];

function OptionRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex h-6 items-center justify-between gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** The import switches, remembered per domain. Components and hover components arrive in Stage 2. */
export function OptionsSheet({
  options,
  onChange,
}: {
  options: ImportOptions;
  onChange: (options: ImportOptions) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col">
          <legend className="flex h-6 items-center font-semibold text-figma-text-secondary">
            {group.title}
          </legend>
          {group.rows.map(({ key, label }) => (
            <OptionRow
              key={key}
              label={label}
              checked={options[key]}
              // Matching existing styles does nothing while styles are not created or bound.
              disabled={key === "useLocalStyles" && !options.tokens}
              onChange={(value) => onChange({ ...options, [key]: value })}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
