import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Select,
  title: "Inputs/Select",
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-[180px]" aria-label="Options">
        <SelectValue placeholder="Choose option" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2">Option 2</SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByLabelText("Options");
    await userEvent.click(trigger);
    const option = await within(document.body).findByRole("option", { name: "Option 2" });
    await expect(option).toBeVisible();
    await userEvent.click(option);
  },
};

export const ManyOptions: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Text align" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="left">Left</SelectItem>
        <SelectItem value="center">Center</SelectItem>
        <SelectItem value="right">Right</SelectItem>
        <SelectItem value="justify">Justify</SelectItem>
      </SelectContent>
    </Select>
  ),
};
