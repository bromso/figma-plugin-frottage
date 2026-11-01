import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../index";
import type { ReviewFont } from "./import-flow";

/** Each font the file uses that the user lacks, with a replacement to pick. Pre-filled, never blocking. */
export function FontTable({
  fonts,
  families,
  choices,
  onChoose,
}: {
  fonts: ReviewFont[];
  families: string[];
  choices: ReadonlyMap<string, string>;
  onChoose: (family: string, choice: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex h-6 items-center font-semibold text-figma-text-secondary">Missing fonts</p>
      <ul className="flex flex-col gap-1">
        {fonts.map(({ family, choice }) => (
          <li key={family} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{family}</span>
            <Select
              value={choices.get(family) ?? choice}
              onValueChange={(v) => onChoose(family, v)}
            >
              <SelectTrigger aria-label={`Replacement for ${family}`} className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {families.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>
    </div>
  );
}
