import { Checkbox, Label } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Checkbox,
  title: "Inputs/Checkbox",
  tags: ["autodocs"],
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="checkbox-default" />
      <Label htmlFor="checkbox-default">Enable option</Label>
    </div>
  ),
};

export const Checked: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="checkbox-checked" defaultChecked />
      <Label htmlFor="checkbox-checked">Already checked</Label>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="checkbox-disabled" disabled />
      <Label htmlFor="checkbox-disabled">Disabled checkbox</Label>
    </div>
  ),
};
