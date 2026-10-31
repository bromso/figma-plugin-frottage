import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/tabs.png";

const meta = { title: "UI3/Tabs", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Tabs: 1–4 tabs; selected / unselected / hover / focused">
      <Tabs defaultValue="design">
        <TabsList>
          <TabsTrigger value="design">Active tab</TabsTrigger>
          <TabsTrigger value="proto">Second tab</TabsTrigger>
          <TabsTrigger value="inspect">Third tab</TabsTrigger>
          <TabsTrigger value="off" disabled>
            Disabled
          </TabsTrigger>
        </TabsList>
        <TabsContent value="design">Design content</TabsContent>
        <TabsContent value="proto">Prototype content</TabsContent>
        <TabsContent value="inspect">Inspect content</TabsContent>
      </Tabs>
      <Tabs defaultValue="a">
        <TabsList variant="line">
          <TabsTrigger value="a">Layers</TabsTrigger>
          <TabsTrigger value="b">Assets</TabsTrigger>
        </TabsList>
      </Tabs>
    </ParityFrame>
  ),
};
