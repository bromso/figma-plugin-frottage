import { Alert, AlertDescription, AlertTitle } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Alert,
  title: "Feedback/Alert",
  tags: ["autodocs"],
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Alert>
      <AlertTitle>Tip</AlertTitle>
      <AlertDescription>Select a layer to get started.</AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive">
      <AlertTitle>Warning</AlertTitle>
      <AlertDescription>No layers selected. Please select at least one layer.</AlertDescription>
    </Alert>
  ),
};
