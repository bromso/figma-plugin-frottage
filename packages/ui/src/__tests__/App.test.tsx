import { describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";
import {
  downscaledFile,
  fakePort,
  fontFile,
  frottageFile,
  repeatedFile,
} from "../import/__tests__/helpers";

describe("App (import screen)", () => {
  it("has a labelled file input with no accept filter", () => {
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose a .frottage file");
    expect(input).not.toHaveAttribute("accept");
    expect(screen.getByRole("button", { name: /Choose a file/ })).toBeInTheDocument();
  });

  it("shows the report when an import finishes, then allows another", async () => {
    const user = userEvent.setup();
    const port = fakePort();
    port.endResult = { rootId: "1:2", failedOps: 2, missingImages: 0, rewrappedTexts: 5 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(3));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("Text").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Failed layers")).toBeInTheDocument();
    expect(screen.queryByText("Missing images")).toBeNull();
    expect(screen.getByText("Text blocks that wrap differently").nextSibling).toHaveTextContent(
      "5"
    );
    await user.click(screen.getByRole("button", { name: "Import another file" }));
    expect(screen.getByRole("button", { name: /Choose a file/ })).toBeInTheDocument();
  });

  it("shows text that came out a different size only when there is some", async () => {
    const user = userEvent.setup();
    const port = fakePort();
    port.endResult = { rootId: "1:2", failedOps: 0, missingImages: 0, textDriftCount: 4 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(3));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("Text blocks that changed size").nextSibling).toHaveTextContent("4");
    await user.click(screen.getByRole("button", { name: "Import another file" }));
    port.endResult = { rootId: "1:2", failedOps: 0, missingImages: 0 };
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(3));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.queryByText("Text blocks that changed size")).toBeNull();
  });

  it("shows the multi-file notice inside the done report", async () => {
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose a .frottage file");
    fireEvent.change(input, {
      target: { files: [frottageFile(1), frottageFile(1, 1, "second.frottage")] },
    });
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText(/more than one file/)).toBeInTheDocument();
  });

  it("shows the downscaled image count only when there is one", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose a .frottage file");
    await user.upload(input, await downscaledFile());
    expect(await screen.findByText("Images downscaled")).toBeInTheDocument();
    expect(screen.getByText("Images downscaled").nextSibling).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Import another file" }));
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    await screen.findByText("Import complete");
    expect(screen.queryByText("Images downscaled")).toBeNull();
  });

  it("renders a failure in an alert as plain text", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App port={fakePort()} />);
    await user.upload(
      screen.getByLabelText("Choose a .frottage file"),
      new File([new Uint8Array([1, 2, 3])], "x.txt")
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This isn't a Frottage file");
  });

  it("shows progress in a status region while working", async () => {
    const port = fakePort();
    let release: () => void = () => {};
    port.begin = () => new Promise<void>((r) => (release = r));
    render(<App port={port} />);
    const input = screen.getByLabelText("Choose a .frottage file");
    await act(async () => {
      await userEvent.setup().upload(input, frottageFile(2));
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Importing"));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toContainElement(screen.getByRole("progressbar"));
    await act(async () => release());
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Import finished");
  });

  it("keeps one status region mounted throughout", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort()} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    await screen.findByText("Import complete");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("moves focus to the result heading and to the error", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose a .frottage file");
    await user.upload(input, new File([new Uint8Array([1])], "x.txt"));
    expect(await screen.findByRole("alert")).toHaveFocus();
    await user.upload(input, frottageFile(1));
    expect(await screen.findByText("Import complete")).toHaveFocus();
  });

  it("clears the multiple-files notice on reset and on the next start", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort()} />);
    const area = screen.getByRole("group", { name: "Drop area" });
    await act(async () => {
      area.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: { files: [frottageFile(1), frottageFile(1)] },
        })
      );
    });
    await screen.findByText("Import complete");
    expect(screen.getByText(/more than one file/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import another file" }));
    expect(screen.queryByText(/more than one file/)).toBeNull();
  });

  it("two quick picks start one import", async () => {
    const port = fakePort();
    render(<App port={port} />);
    const input = screen.getByLabelText("Choose a .frottage file");
    await act(async () => {
      fireEvent.change(input, { target: { files: [frottageFile(1)] } });
      fireEvent.change(input, { target: { files: [frottageFile(1)] } });
    });
    await screen.findByText("Import complete");
    expect(port.log.filter((l) => l === "begin")).toHaveLength(1);
  });

  it("uses the first dropped file and says so when the import fails", async () => {
    render(<App port={fakePort()} />);
    const area = screen.getByRole("group", { name: "Drop area" });
    const junk = () => new File([new Uint8Array([1, 2, 3])], "x.txt");
    await act(async () => {
      area.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: { files: [junk(), junk()] },
        })
      );
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/more than one file/)).toBeInTheDocument();
  });
});

const fonts = [
  { family: "Inter", style: "Regular" },
  { family: "Roboto", style: "Regular" },
];

describe("App (options and font table)", () => {
  it("imports straight away when no font is missing", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
  });

  it("opens the options for the next file, grouped, without the Stage 2 options", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    render(<App port={port} />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    expect(await screen.findByText("Enhancements")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Options" })).toBeInTheDocument();
    for (const name of [
      "Auto layout",
      "HTML layer names",
      "Create styles and variables",
      "Use existing local styles",
      "Hyperlinks",
    ]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("switch", { name: /Components|Hover/ })).toBeNull();
    expect(screen.getByRole("switch", { name: "Auto layout" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "HTML layer names" })).not.toBeChecked();

    await user.click(screen.getByRole("switch", { name: "Auto layout" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(port.tokensOptions).toMatchObject({ autoLayout: false });
    expect(port.prefs.get("options:example.com")).toMatchObject({ autoLayout: false });
  });

  it("disables Use existing local styles while styles are off", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    const local = await screen.findByRole("switch", { name: "Use existing local styles" });
    expect(local).toBeEnabled();
    await user.click(screen.getByRole("switch", { name: "Create styles and variables" }));
    expect(local).toBeDisabled();
  });

  it("lists each missing font with a labelled choice and never blocks Import", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), fontFile("Nimbus Sans"));
    const choice = await screen.findByRole("combobox", { name: "Replacement for Nimbus Sans" });
    expect(choice).toHaveTextContent("Inter");
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("Nimbus Sans replaced by Inter Regular")).toBeInTheDocument();
  });

  it("applies a chosen font", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), fontFile("Nimbus Sans"));
    const choice = await screen.findByRole("combobox", { name: "Replacement for Nimbus Sans" });
    await user.click(choice);
    await user.click(await screen.findByRole("option", { name: "Roboto" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(port.beginMeta?.fonts).toEqual([{ family: "Roboto", style: "Regular" }]);
    expect(port.prefs.get("font:Nimbus Sans")).toBe("Roboto");
  });

  it("moves focus to the review heading", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), fontFile("Nimbus Sans"));
    const heading = await screen.findByText("Import settings");
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("cancels back to the drop area with nothing created", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), fontFile("Nimbus Sans"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: /Choose a file/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    expect(port.log).not.toContain("begin");
    // The next plain file is not reviewed.
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
  });

  it("keeps the Import button outside the scrolling list", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), fontFile("Nimbus Sans"));
    const list = await screen.findByTestId("review-scroll");
    expect(list.className).toContain("overflow-y-auto");
    expect(list).not.toContainElement(screen.getByRole("button", { name: "Import" }));
  });

  it("reports auto layout, fallbacks, tokens and dropped tokens", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = {
      ...port.endResult,
      autoLayoutFrames: 7,
      fallbackFrames: 2,
      stylesCreated: 3,
      stylesReused: 4,
      variablesCreated: 5,
      variablesReused: 6,
      tokenFailures: 2,
    };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    await screen.findByText("Import complete");
    const row = (label: string) => screen.getByText(label).nextSibling;
    expect(row("Auto layout frames")).toHaveTextContent("7");
    expect(row("Frames without auto layout")).toHaveTextContent("2");
    expect(row("Styles created")).toHaveTextContent("3");
    expect(row("Styles reused")).toHaveTextContent("4");
    expect(row("Variables created")).toHaveTextContent("5");
    expect(row("Variables reused")).toHaveTextContent("6");
    expect(screen.getByText(/2 styles or variables could not be created/)).toBeInTheDocument();
  });

  it("reports components, instances on the canvas, and failed overrides", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, componentsCreated: 1, overrideFailures: 2 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText("Components").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Instances").nextSibling).toHaveTextContent("3");
    expect(
      screen.getByText(
        "2 instance layers could not be changed and show the component's own content."
      )
    ).toBeInTheDocument();
  });

  it("says at least, when a failed override is in a component", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, overrideFailures: 1, overrideFailuresInMains: 1 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(
      screen.getByText(
        "At least 1 instance layer could not be changed and shows the component's own content."
      )
    ).toBeInTheDocument();
  });

  it("counts the instances that landed when layers failed", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, failedOps: 2, instancesCreated: 1 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText("Instances").nextSibling).toHaveTextContent("1");
  });

  it("says so when the components could not be arranged", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, layoutFailures: 1 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText(/could not be arranged/)).toBeInTheDocument();
  });

  it("leaves component rows out when nothing repeats", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    await screen.findByText("Import complete");
    expect(screen.queryByText("Components")).toBeNull();
    expect(screen.queryByText("Instances")).toBeNull();
    expect(screen.queryByText(/could not be changed/)).toBeNull();
    expect(screen.queryByText(/could not be arranged/)).toBeNull();
  });

  it("leaves token rows out when nothing happened", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(1));
    await screen.findByText("Import complete");
    expect(screen.queryByText("Styles created")).toBeNull();
    expect(screen.queryByText(/could not be created/)).toBeNull();
  });
});
