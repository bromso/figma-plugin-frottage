import { describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";
import { downscaledFile, fakePort, frottageFile } from "../import/__tests__/helpers";

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
