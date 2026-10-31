import { Checkbox, Label } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import type * as React from "react";
import { ParityFrame } from "./_parity";
import ref from "./refs/checkbox.png";

const meta = { title: "UI3/Checkbox", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

function Row({
  id,
  label,
  col,
  ...props
}: { id: string; label: string; col: "light" | "dark" } & React.ComponentProps<typeof Checkbox>) {
  const fullId = `${id}-${col}`;
  return (
    <div className="flex h-6 items-center gap-2">
      <Checkbox id={fullId} {...props} />
      <Label htmlFor={fullId}>{label}</Label>
    </div>
  );
}

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame
      reference={ref}
      caption="Checkbox: Checked / Unchecked / Mixed × Default / Disabled, with label"
    >
      {(col) => (
        <>
          <Row id="c1" col={col} label="On, Normal" defaultChecked />
          <Row id="c2" col={col} label="Off, Normal" />
          <Row id="c3" col={col} label="Mixed" checked="indeterminate" />
          <Row id="c4" col={col} label="On, Disabled" defaultChecked disabled />
          <Row id="c5" col={col} label="Off, Disabled" disabled />
        </>
      )}
    </ParityFrame>
  ),
};
