import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProviderKeyCard } from "./ProviderKeyCard";
import { useSettingsStore } from "@/state/settingsStore";
import { setTransportFetch } from "@/lib/transport/transport";
import type { ProviderId } from "@/types";

const okCompletion = (text = "جاهز") => ({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 5, completion_tokens: 1 } });

const id: ProviderId = "minimax";

// Several tests replace the store action with a spy; the real one must come back
// between tests or a later test writes into a mock that never updates the store.
const realSetProviderKey = useSettingsStore.getState().setProviderKey;

function resetStores(): void {
  useSettingsStore.setState({
    providerKeys: {},
    primaryTarget: null,
    sessionRootDir: null,
    timeoutMs: 120_000,
    loaded: false,
    setProviderKey: realSetProviderKey,
  });
}

beforeEach(() => {
  resetStores();
  vi.restoreAllMocks();
});

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

  it("يضع تسمية برمجية ونوع password لحقل المفتاح", () => {
    render(<ProviderKeyCard id={id} />);
    const field = screen.getByPlaceholderText("مفتاح API");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAccessibleName(/مفتاح/);
  });

  it("لا يحفظ عند كل ضربة مفتاح ويحفظ عند مغادرة الحقل", async () => {
    const setProviderKey = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ setProviderKey });
    render(<ProviderKeyCard id={id} />);

    fireEvent.change(screen.getByPlaceholderText("مفتاح API"), { target: { value: "sk-minimax-1" } });
    expect(setProviderKey).not.toHaveBeenCalled();

    fireEvent.blur(screen.getByPlaceholderText("مفتاح API"));
    await waitFor(() => expect(setProviderKey).toHaveBeenCalledWith(id, "sk-minimax-1"));
  });

  it("يرفض مفتاحًا يتجاوز الحد ولا يحفظ شيئًا", async () => {
    const setProviderKey = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ setProviderKey });
    render(<ProviderKeyCard id={id} />);

    fireEvent.change(screen.getByPlaceholderText("مفتاح API"), { target: { value: "a".repeat(513) } });
    fireEvent.blur(screen.getByPlaceholderText("مفتاح API"));

    expect(setProviderKey).not.toHaveBeenCalled();
    expect(await screen.findByText(/الحد المسموح/)).toBeInTheDocument();
  });

  it("يمسح المفتاح المحفوظ", async () => {
    const setProviderKey = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ providerKeys: { [id]: "sk-existing" }, setProviderKey });
    render(<ProviderKeyCard id={id} />);

    fireEvent.click(screen.getByRole("button", { name: /مسح/ }));

    await waitFor(() => expect(setProviderKey).toHaveBeenCalledWith(id, ""));
  });

  it("زر الاختبار يبقى معطّلًا بالمسودة وحدها ويتفعّل بعد الحفظ", async () => {
    render(<ProviderKeyCard id={id} />);
    const btn = screen.getByRole("button", { name: /اختبار/ });
    const field = screen.getByPlaceholderText("مفتاح API");
    expect(btn).toBeDisabled();
    fireEvent.change(field, { target: { value: "sk-1" } });
    expect(btn).toBeDisabled();
    fireEvent.blur(field);
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("نجاح الاختبار الحي: «المفتاح يعمل ✓» بلون النجاح ونداء بالنموذج الأول للمزود", async () => {
    let body = "";
    setTransportFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      body = String(init?.body ?? "");
      return new Response(JSON.stringify(okCompletion()), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch);
    useSettingsStore.setState({ providerKeys: { [id]: "sk-1" } });
    render(<ProviderKeyCard id={id} />);
    fireEvent.click(screen.getByRole("button", { name: /اختبار/ }));
    const result = await screen.findByText("المفتاح يعمل ✓", {}, { timeout: 3000 });
    expect(result).toHaveClass("text-sura-accent");
    expect(JSON.parse(body).model).toBe("MiniMax-M2");
  });

  it("يختبر المفتاح المحفوظ لا المسودة غير المحفوظة", async () => {
    useSettingsStore.setState({ providerKeys: { [id]: "sk-saved" } });
    let seenAuthorization = "";
    setTransportFetch(async (_input, init) => {
      seenAuthorization = new Headers(init?.headers ?? {}).get("authorization") ?? "";
      return new Response(JSON.stringify(okCompletion()), { status: 200, headers: { "content-type": "application/json" } });
    });
    render(<ProviderKeyCard id={id} />);

    fireEvent.change(screen.getByPlaceholderText("مفتاح API"), { target: { value: "sk-unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: /اختبار/ }));

    await waitFor(() => expect(seenAuthorization).not.toBe(""));
    expect(seenAuthorization).toContain("sk-saved");
    expect(seenAuthorization).not.toContain("sk-unsaved");
  });

  it("فشل الاختبار (401): رسالة المفتاح غير الصالح بلون الخطر", async () => {
    setTransportFetch(async () => new Response(JSON.stringify({ error: {} }), { status: 401 }));
    useSettingsStore.setState({ providerKeys: { openrouter: "bad" } });
    render(<ProviderKeyCard id="openrouter" />);
    fireEvent.click(screen.getByRole("button", { name: /اختبار/ }));
    const result = await screen.findByText(/مفتاح غير صالح/, {}, { timeout: 3000 });
    expect(result).toHaveClass("text-sura-danger");
  });
});