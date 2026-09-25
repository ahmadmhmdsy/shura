import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddModelDialog } from "./AddModelDialog";
import { setTransportFetch } from "@/lib/transport/transport";

const catalog = (id: string) => new Response(JSON.stringify({ data: [{ id, name: `Live ${id}`, pricing: { prompt: "0.000001", completion: "0.000002" } }] }), { status: 200, headers: { "content-type": "application/json" } });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe("AddModelDialog model discovery", () => {
  it("shows the static list first and then the live list", async () => {
    setTransportFetch(async () => catalog("live/model"));
    render(<AddModelDialog open onOpenChange={() => undefined} onPick={() => undefined} />);

    fireEvent.click(screen.getByText("OpenRouter"));

    expect(screen.getByText("openai/gpt-4o")).toBeTruthy();
    expect(await screen.findByText("Live live/model")).toBeTruthy();
  });

  it("ignores a stale response after the provider selection changes", async () => {
    const first = deferred<Response>();
    setTransportFetch(async () => first.promise);
    render(<AddModelDialog open onOpenChange={() => undefined} onPick={() => undefined} />);

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع" }));
    fireEvent.click(screen.getByText("Google Gemini"));
    await waitFor(() => expect(screen.getByText("Gemini 2.5 Pro")).toBeTruthy());

    // A late response from the abandoned OpenRouter request must not repopulate the list.
    first.resolve(catalog("stale/model"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByText("Live stale/model")).toBeNull();
    expect(screen.getByText("Gemini 2.5 Pro")).toBeTruthy();
  });

  it("keeps the static list and warns when discovery fails", async () => {
    setTransportFetch(async () => new Response("nope", { status: 503 }));
    render(<AddModelDialog open onOpenChange={() => undefined} onPick={() => undefined} />);

    fireEvent.click(screen.getByText("OpenRouter"));

    expect(await screen.findByText(/تعذر جلب قائمة الموديلات/)).toBeTruthy();
    expect(screen.getByText("openai/gpt-4o")).toBeTruthy();
  });

  it("aborts the live request when the dialog closes", async () => {
    const seen: AbortSignal[] = [];
    setTransportFetch(async (_input, init) => {
      const signal = init?.signal;
      if (signal) seen.push(signal);
      return new Promise<Response>((resolve) => {
        signal?.addEventListener("abort", () => resolve(new Response("{}", { status: 499 })));
      });
    });
    const { rerender } = render(<AddModelDialog open onOpenChange={() => undefined} onPick={() => undefined} />);

    fireEvent.click(screen.getByText("OpenRouter"));
    await waitFor(() => expect(seen).toHaveLength(1));

    rerender(<AddModelDialog open={false} onOpenChange={() => undefined} onPick={() => undefined} />);

    await waitFor(() => expect(seen[0].aborted).toBe(true));
  });

  it("passes the full model metadata to onPick", async () => {
    setTransportFetch(async () => catalog("vendor/full"));
    const onPick = vi.fn();
    render(<AddModelDialog open onOpenChange={() => undefined} onPick={onPick} />);

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.click(await screen.findByText("Live vendor/full"));

    expect(onPick).toHaveBeenCalledWith("openrouter", expect.objectContaining({
      id: "vendor/full",
      pricing: expect.objectContaining({ inputPerMTok: 1, outputPerMTok: 2 }),
    }));
  });
});
