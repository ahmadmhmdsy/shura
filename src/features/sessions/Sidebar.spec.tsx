import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore } from "@/state/composerStore";

const session = {
  id: "side-1", title: "جلسة جانبية", createdAt: 1, updatedAt: 1, modelIds: [],
  primaryTarget: null, layoutMode: "vertical" as const, onDisk: true, onDiskDir: "folder-side",
};

beforeEach(() => {
  useSessionsStore.setState({ sessions: [session], currentId: null, messages: [] });
  useComposerStore.setState({ drafts: {} });
  window.confirm = vi.fn(() => true);
});

describe("Sidebar durable deletion", () => {
  it("يعرض تحذيرًا قابلًا لإعادة المحاولة عند فشل حذف الأرشيف", async () => {
    const remove = vi.fn()
      .mockResolvedValueOnce({ deleted: true, warning: "تعذر حذف ملفات الأرشيف", retryable: true })
      .mockResolvedValueOnce({ deleted: true });
    useSessionsStore.setState({ remove } as never);
    render(<Sidebar onOpenSettings={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /حذف/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذر حذف ملفات الأرشيف");
    expect(remove).toHaveBeenCalledWith("side-1");

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove.mock.calls[1][0]).toBe("side-1");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("يعرض خطأ الحذف كتحذير محدود دون إسقاط التطبيق", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("تعذر حذف بيانات الجلسة: EPERM: C:\\Users\\name\\Shura key=sk-abcdefghijklmnopqrstuvwx"));
    useSessionsStore.setState({ remove } as never);
    render(<Sidebar onOpenSettings={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /حذف/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذر حذف بيانات الجلسة");
    expect(alert).not.toHaveTextContent("C:\\Users");
    expect(alert).not.toHaveTextContent("sk-abcdefghijklmnopqrstuvwx");
  });

  it("لا يحذف عند إلغاء التأكيد", () => {
    window.confirm = vi.fn(() => false);
    const remove = vi.fn().mockResolvedValue({ deleted: true });
    useSessionsStore.setState({ remove } as never);
    render(<Sidebar onOpenSettings={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /حذف/ }));
    expect(remove).not.toHaveBeenCalled();
  });
});
