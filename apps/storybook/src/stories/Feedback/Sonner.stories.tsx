import { Button, Toaster } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { toast } from "sonner";

const meta = {
  component: Toaster,
  title: "Feedback/Sonner",
  tags: ["autodocs"],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div>
      <Toaster />
      <Button
        variant="outline"
        onClick={() =>
          toast("Event has been created", {
            description: "Sunday, December 03, 2023 at 9:00 AM",
          })
        }
      >
        Show Toast
      </Button>
    </div>
  ),
};
