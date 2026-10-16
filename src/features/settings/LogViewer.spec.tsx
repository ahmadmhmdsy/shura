import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogViewer, type LogSnapshot } from "./LogViewer";
import type { LogEntry, RunMetrics } from "@/lib/logging";
import { ar } from "@/i18n/ar";

function metrics(over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    // ٦٥ ثانية مضت ⇒ «1د 5ث»، مع هامش يمنع تأرجح الثانية أثناء التنفيذ.
    appStartTime: Date.now() - 65_500,
    sessionCount: 3,
    messageCount: 7,
    errorCount: 1,
    performanceMarks: {},
    ...over,
  };
}

function entry(over: Partial<LogEntry> = {}): LogEntry {
  return { timestamp: Date.now(), level: "info", message: "رسالة", ...over };
}

/** مصدر ساكن: نفس اللقطة في كل قراءة. */
function source(entries: LogEntry[], over: Partial<RunMetrics> = {}): () => LogSnapshot {
  return () => ({ entries, metrics: metrics(over) });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LogViewer", () => {
  it("يعرض مقاييس الجولة ومدة التشغيل", () => {
    render(<LogViewer read={source([])} />);

    expect(screen.getByText(ar.dev.sessions).nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText(ar.dev.messages).nextElementSibling).toHaveTextContent("7");
    expect(screen.getByText(ar.dev.errors).nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText(ar.dev.uptime).nextElementSibling).toHaveTextContent("1د 5ث");
  });

  it("يعرض الرسائل من الأحدث إلى الأقدم مع المستوى والسياق والخطأ", () => {
    render(
      <LogViewer
        read={source([
          entry({ timestamp: 1_700_000_000_000, level: "info", message: "الأولى" }),
          entry({
            timestamp: 1_700_000_001_000,
            level: "error",
            message: "الثانية",
            context: { providerId: "openrouter" },
            error: new Error("انفجر"),
          }),
        ])}
      />,
    );

    const items = screen.getByTestId("log-entries").querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("الثانية");
    expect(items[1]).toHaveTextContent("الأولى");
    expect(items[0]).toHaveTextContent("[خطأ]");
    expect(items[1]).toHaveTextContent("[معلومة]");
    expect(items[0]).toHaveTextContent("انفجر");
    expect(items[0]).toHaveTextContent('{"providerId":"openrouter"}');
  });

  it("الفلترة بالمستوى تُخفي بقية المستويات وتُظهر العدّاد المطابق", () => {
    render(
      <LogViewer
        read={source([
          entry({ level: "debug", message: "تتبّع-1" }),
          entry({ level: "warn", message: "تحذير-1" }),
          entry({ level: "warn", message: "تحذير-2" }),
        ])}
      />,
    );

    expect(screen.getByTestId("log-entries").querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "warn" } });

    const items = screen.getByTestId("log-entries").querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("تحذير-2");
    expect(screen.queryByText("تتبّع-1")).not.toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("سجل فارغ: رسالة صريحة بدل قائمة فارغة", () => {
    render(<LogViewer read={source([])} />);
    expect(screen.getByText(ar.dev.empty)).toBeInTheDocument();
    expect(screen.queryByTestId("log-entries")).not.toBeInTheDocument();
  });

  it("فلترة بمستوى لا يطابق شيئًا تعرض الحالة الفارغة أيضًا", () => {
    render(<LogViewer read={source([entry({ level: "info", message: "معلومة-1" })])} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "error" } });
    expect(screen.getByText(ar.dev.empty)).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
  });

  it("زر «تحديث» يعيد القراءة من المصدر", () => {
    let calls = 0;
    const read = () => ({ entries: [entry({ message: calls++ === 0 ? "أول" : "ثانٍ" })], metrics: metrics() });

    render(<LogViewer read={read} />);
    expect(screen.getByText("أول")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ar.dev.refresh }));

    expect(screen.getByText("ثانٍ")).toBeInTheDocument();
    expect(screen.queryByText("أول")).not.toBeInTheDocument();
  });

  it("يستطلع المصدر كل ثانية ما دام مفتوحًا، ويتوقف عند الإزالة", () => {
    vi.useFakeTimers();
    let calls = 0;
    const read = () => ({ entries: [entry({ message: "قراءة-" + calls++ })], metrics: metrics() });

    const { unmount } = render(<LogViewer read={read} />);
    expect(calls).toBe(1);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(calls).toBe(2);

    act(() => { vi.advanceTimersByTime(2000); });
    expect(calls).toBe(4);

    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(calls).toBe(4);
  });
});
