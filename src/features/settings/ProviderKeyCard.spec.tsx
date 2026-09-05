import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProviderKeyCard } from "./ProviderKeyCard";
import { useSettingsStore } from "@/state/settingsStore";
import { setTransportFetch } from "@/lib/transport/transport";

const okCompletion = (text = "جاهز") => ({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 5, completion_tokens: 1 } });

function resetStores(): void {
  useSettingsStore.setState({ providerKeys: {}, primaryTarget: null, sessionRootDir: null, timeoutMs: 120_000, loaded: false });
}

beforeEach(resetStores);

describe("ProviderKeyCard", () => {
  it("يعرض تسمية المزود وشارة سطح المكتب للمزود غير المباشر فقط", () => {
    const { unmount } = render(<ProviderKeyCard id="openrouter" />);
    expect(screen.getByText("OpenRouter")).toBeInTheDocument();
    expect(screen.queryByText(/سطح المكتب/)).not.toBeInTheDocument();
    unmount();
    render(<ProviderKeyCard id="opencodego" />);
    expect(screen.getByText("OpenCode Go")).toBeInTheDocument();
    expect(screen.getByText(/سطح المكتب/)).toBeInTheDocument();
  });

  it("كتابة المفتاح تحفظه في مخزن الإعدادات", async () => {
    render(<ProviderKeyCard id="minimax" />);
    fireEvent.change(screen.getByPlaceholderText("مفتاح API"), { target: { value: "sk-minimax-1" } });
    await waitFor(() => expect(useSettingsStore.getState().providerKeys.minimax).toBe("sk-minimax-1"));
  });

  it("زر الاختبار معطّل بلا مفتاح ومفعّل بعد كتابته", async () => {
    render(<ProviderKeyCard id="minimax" />);
    const btn = screen.getByRole("button", { name: /اختبار/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("مفتاح API"), { target: { value: "sk-1" } });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("نجاح الاختبار الحي: «المفتاح يعمل ✓» بلون النجاح ونداء بالنموذج الأول للمزود", async () => {
    let body = "";
    setTransportFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      body = String(init?.body ?? "");
      return new Response(JSON.stringify(okCompletion()), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch);
    render(<ProviderKeyCard id="minimax" />);
    fireEvent.change(screen.getByPlaceholderText("مفتاح API"), { target: { value: "sk-1" } });
    fireEvent.click(screen.getByRole("button", { name: /اختبار/ }));
    const result = await screen.findByText("المفتاح يعمل ✓", {}, { timeout: 3000 });
    expect(result).toHaveClass("text-sura-accent");
    expect(JSON.parse(body).model).toBe("MiniMax-M2");
  });

  it("فشل الاختبار (401): رسالة المفتاح غير الصالح بلون الخطر", async () => {
    setTransportFetch(async () => new Response(JSON.stringify({ error: {} }), { status: 401 }));
    render(<ProviderKeyCard id="openrouter" />);
    fireEvent.change(screen.getByPlaceholderText("مفتاح API"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /اختبار/ }));
    const result = await screen.findByText(/مفتاح غير صالح/, {}, { timeout: 3000 });
    expect(result).toHaveClass("text-sura-danger");
  });
});
