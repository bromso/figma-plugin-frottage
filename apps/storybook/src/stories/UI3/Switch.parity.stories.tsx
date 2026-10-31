import { Label, Switch } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import type * as React from "react";
import { ParityFrame } from "./_parity";
import ref from "./refs/switch.png";

const meta = { title: "UI3/Switch", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

function Row({
  id,
  label,
  col,
  ...props
}: { id: string; label: string; col: "light" | "dark" } & React.ComponentProps<typeof Switch>) {
  const fullId = `${id}-${col}`;
  return (
    <div className="flex h-6 items-center gap-2">
      <Switch id={fullId} {...props} />
      <Label htmlFor={fullId}>{label}</Label>
    </div>
  );
}

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Switch: On / Off / Mixed × Default / Focused / Disabled">
      {(col) => (
        <>
          <Row id="s1" col={col} label="On, Normal" defaultChecked />
          <Row id="s2" col={col} label="Off, Normal" />
          <Row id="s3" col={col} label="On, Disabled" defaultChecked disabled />
          <Row id="s4" col={col} label="Off, Disabled" disabled />
          <p className="text-figma-text-secondary">
            Tab to a switch to see the focus ring. Radix Switch has no mixed state.
          </p>
        </>
      )}
    </ParityFrame>
  ),
};
