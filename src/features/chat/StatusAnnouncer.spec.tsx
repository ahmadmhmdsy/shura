import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusAnnouncer } from "@/features/chat/StatusAnnouncer";
import { useSessionsStore } from "@/state/sessionsStore";

const message = (status: string, error?: string) => ({ id: "m1", role: "assistant", status, error, text: "نص" });

beforeEach(() => {
  useSessionsStore.setState({ messages: [], loading: false } as never);
});

describe("StatusAnnouncer", () => {
  it("exposes a polite live region", () => {
    render(<StatusAnnouncer />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
  });

  it("says nothing while idle", () => {
    render(<StatusAnnouncer />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("announces loading", () => {
    useSessionsStore.setState({ loading: true } as never);
    render(<StatusAnnouncer />);
    expect(screen.getByRole("status").textContent).toBe("جارٍ تحميل الجلسة");
  });

  it("announces generation", () => {
    useSessionsStore.setState({ messages: [message("streaming")] as never } as never);
    render(<StatusAnnouncer />);
    expect(screen.getByRole("status").textContent).toBe("جارٍ توليد الرد");
  });

  it("announces a stop", () => {
    useSessionsStore.setState({ messages: [message("stopped")] as never } as never);
    render(<StatusAnnouncer />);
    expect(screen.getByRole("status").textContent).toBe("أُوقف التوليد");
  });

  it("announces a failure with the reason", () => {
    useSessionsStore.setState({ messages: [message("error", "انتهت المهلة")] as never } as never);
    render(<StatusAnnouncer />);
    expect(screen.getByRole("status").textContent).toBe("فشل التوليد: انتهت المهلة");
  });

  it("announces completion", () => {
    useSessionsStore.setState({ messages: [message("done")] as never } as never);
    render(<StatusAnnouncer />);
    expect(screen.getByRole("status").textContent).toBe("انتهى الرد");
  });

  it("announces a truncated stream distinctly from completion", () => {
    useSessionsStore.setState({ messages: [message("truncated")] as never } as never);
    render(<StatusAnnouncer />);
    expect(screen.getByRole("status").textContent).toBe("انتهى التوليد مبكرًا: الرد غير مكتمل");
  });

  it("never reads the model output aloud", () => {
    useSessionsStore.setState({ messages: [{ ...message("done"), text: "محتوى سرّي" }] as never } as never);
    render(<StatusAnnouncer />);
    expect(screen.getByRole("status").textContent).not.toContain("محتوى سرّي");
  });
});
