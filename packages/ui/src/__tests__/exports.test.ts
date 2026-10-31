import { describe, expect, it } from "bun:test";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  cn,
  Icon,
  IconButton,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  SectionTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  Type,
  useFigmaTheme,
} from "../index";

describe("@repo/ui exports", () => {
  it("exports all shadcn/ui and custom components", () => {
    expect(Button).toBeDefined();
    expect(Checkbox).toBeDefined();
    expect(Input).toBeDefined();
    expect(Label).toBeDefined();
    expect(Select).toBeDefined();
    expect(SelectContent).toBeDefined();
    expect(SelectItem).toBeDefined();
    expect(SelectTrigger).toBeDefined();
    expect(SelectValue).toBeDefined();
    expect(Switch).toBeDefined();
    expect(Textarea).toBeDefined();
    expect(RadioGroup).toBeDefined();
    expect(RadioGroupItem).toBeDefined();
    expect(Accordion).toBeDefined();
    expect(AccordionItem).toBeDefined();
    expect(AccordionTrigger).toBeDefined();
    expect(AccordionContent).toBeDefined();
    expect(Alert).toBeDefined();
    expect(AlertDescription).toBeDefined();
    expect(AlertTitle).toBeDefined();
    expect(Icon).toBeDefined();
    expect(IconButton).toBeDefined();
    expect(SectionTitle).toBeDefined();
    expect(Type).toBeDefined();
    expect(useFigmaTheme).toBeDefined();
  });

  it("exports cn utility", () => {
    expect(cn).toBeDefined();
    expect(cn("a", "b")).toBe("a b");
  });
});
