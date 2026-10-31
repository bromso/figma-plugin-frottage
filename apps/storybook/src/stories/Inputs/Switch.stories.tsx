import { Label, Switch } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Switch,
  title: "Inputs/Switch",
  tags: ["autodocs"],
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="switch-default" />
      <Label htmlFor="switch-default">Enable feature</Label>
    </div>
  ),
};

export const On: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="switch-on" defaultChecked />
      <Label htmlFor="switch-on">Feature enabled</Label>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="switch-disabled" disabled />
      <Label htmlFor="switch-disabled">Locked setting</Label>
    </div>
  ),
};
