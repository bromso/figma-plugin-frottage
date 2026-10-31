import { Label, RadioGroup, RadioGroupItem } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/radio.png";

const meta = { title: "UI3/Radio", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Radio button: On / Off × Default / Focused, with labels">
      {(col) => (
        <RadioGroup defaultValue="a">
          {["a", "b", "c"].map((v) => (
            <div key={v} className="flex h-6 items-center gap-2">
              <RadioGroupItem value={v} id={`r-${v}-${col}`} />
              <Label htmlFor={`r-${v}-${col}`}>Option {v.toUpperCase()}</Label>
            </div>
          ))}
          <div className="flex h-6 items-center gap-2">
            <RadioGroupItem value="d" id={`r-d-${col}`} disabled />
            <Label htmlFor={`r-d-${col}`}>Disabled</Label>
          </div>
        </RadioGroup>
      )}
    </ParityFrame>
  ),
};
