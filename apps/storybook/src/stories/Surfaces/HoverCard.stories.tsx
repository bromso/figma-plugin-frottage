import { Button, HoverCard, HoverCardContent, HoverCardTrigger } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: HoverCard,
  title: "Surfaces/HoverCard",
  tags: ["autodocs"],
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link">@shadcn</Button>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">@shadcn</h4>
          <p className="text-sm">The creator of shadcn/ui and taxonomy.</p>
          <div className="flex items-center pt-2">
            <span className="text-xs text-muted-foreground">Joined December 2021</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
};
