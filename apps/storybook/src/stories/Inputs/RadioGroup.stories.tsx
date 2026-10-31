import { Label, RadioGroup, RadioGroupItem } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: RadioGroup,
  title: "Inputs/RadioGroup",
  tags: ["autodocs"],
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="option-a">
      <div className="flex h-6 items-center gap-2">
        <RadioGroupItem value="option-a" id="option-a" />
        <Label htmlFor="option-a">Option A</Label>
      </div>
      <div className="flex h-6 items-center gap-2">
        <RadioGroupItem value="option-b" id="option-b" />
        <Label htmlFor="option-b">Option B</Label>
      </div>
      <div className="flex h-6 items-center gap-2">
        <RadioGroupItem value="option-c" id="option-c" />
        <Label htmlFor="option-c">Option C</Label>
      </div>
    </RadioGroup>
  ),
};

export const WithDefault: Story = {
  render: () => (
    <RadioGroup defaultValue="option-b">
      <div className="flex h-6 items-center gap-2">
        <RadioGroupItem value="option-a" id="rg2-option-a" />
        <Label htmlFor="rg2-option-a">Option A</Label>
      </div>
      <div className="flex h-6 items-center gap-2">
        <RadioGroupItem value="option-b" id="rg2-option-b" />
        <Label htmlFor="rg2-option-b">Option B</Label>
      </div>
      <div className="flex h-6 items-center gap-2">
        <RadioGroupItem value="option-c" id="rg2-option-c" />
        <Label htmlFor="rg2-option-c">Option C</Label>
      </div>
    </RadioGroup>
  ),
};
