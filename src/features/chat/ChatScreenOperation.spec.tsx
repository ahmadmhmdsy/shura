import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatScreen } from "./ChatScreen";
import { useSessionsStore } from "@/state/sessionsStore";
import { useComposerStore } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { setTransportFetch } from "@/lib/transport/transport";
import { toast } from "sonner";
import type { ChatMessage } from "@/types";
// مرجع هوية العملية: هوك hoisted حتى يصل إلى مصنع الموك قبل التحويل
const sendProbe = vi.hoisted(() => ({
  calls: [] as {
    cb: {
      onDelta(targetId: string, chunk: string): void;
      onStatus(targetId: string, status: "streaming" | "done" | "error" | "stopped", error?: string): void;
      onDropped(targetIds: string[]): void;
      onAppended(msg: unknown): void;
    };
    resolve: () => void;
  }[],
}));
vi.mock("@/lib/chat/chatController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/chatController")>();
  return {
    ...actual,
    sendTurn: (args: unknown, cb: (typeof sendProbe.calls)[number]["cb"]) =>
      new Promise<ChatMessage[]>((resolve) => {
        sendProbe.calls.push({ cb, resolve: () => resolve([]) });
        // محاكاة التسجيل الحقيقي: كل هدف يستلم إشارة إلغاء مسجلة في ChatScreen
        const a = args as { targets?: { targetId: string }[]; externalSignalFor?: (tid: string) => AbortSignal };
        for (const t of a.targets ?? []) a.externalSignalFor?.(t.targetId);
      }),
  };
});

let n = 0;
async function mkSession(): Promise<import("@/types").SessionMeta> {
  n += 1;
  const s: import("@/types").SessionMeta = { id: "op" + n, title: "جلسة", createdAt: Date.now(), updatedAt: Date.now(), modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false };
  const repos = await import("@/lib/db/repos");
  await repos.createSession(s);
  return s;
}

const ONE: import("@/types").TargetConfig[] = [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", modelInfo: { id: "openai/gpt-4o", label: "GPT-4o" } }];

function seed(session: import("@/types").SessionMeta): void {
  useSessionsStore.setState({ sessions: [session], currentId: session.id, messages: [] });
  useSettingsStore.setState({ providerKeys: { openrouter: "k" }, timeoutMs: 5000 });
  const targets = ONE.map((t) => ({ ...t, targetId: t.targetId + "_" + session.id }));
  useComposerStore.setState({ drafts: { [session.id]: { targets, syncMode: true, sharedPrompt: "س1", customs: {}, focusTargetId: null } } });
}

// تمريرة جاهزة بمعرف هدف مطابق لأهداف المؤلف — تفعّل زر «إعادة» الذي يستدعي persistTurn
// دون حراسة sending، فيسمح بحالة سباق عمليتين في الجلسة نفسها.
function seededTurn(s: import("@/types").SessionMeta): import("@/types").ChatMessage[] {
  return [
    { id: "p1", sessionId: s.id, turnId: "tr1", createdAt: 1, role: "user", kind: "prompt", text: "س1", promptKind: "shared", status: "done" },
    { id: "r1", sessionId: s.id, turnId: "tr1", createdAt: 2, role: "assistant", kind: "result", text: "أهلاً", providerId: "openrouter", modelId: "openai/gpt-4o", targetId: "t1_" + s.id, status: "done" },
  ];
}

beforeEach(() => { setTransportFetch((() => new Promise<Response>(() => {})) as unknown as typeof fetch); });
afterEach(() => { sendProbe.calls.length = 0; });

describe("ChatScreen — هوية العملية (مراجعة المهمة 3)", () => {
  it("ردّ العملية الأقدم المتأخر لا يمس العملية الأحدث في الجلسة نفسها ولا تنظّف حالتها", async () => {
    const s = await mkSession();
    seed(s);
    useSessionsStore.setState({ messages: seededTurn(s) });
    const errSpy = vi.spyOn(toast, "error");
    const warnSpy = vi.spyOn(toast, "warning");
    render(<ChatScreen session={s} />);

    // العملية الأقدم: إرسال يجمد في mocked sendTurn — لا تُحسم أبدًا قبل الإثبات
    fireEvent.click(screen.getByRole("button", { name: /إرسال/ }));
    expect(sendProbe.calls.length).toBe(1);

    // العملية الأحدث: إعادة المحاولة (تتجاوز حارس sending عمدًا كما في الإنتاج)
    fireEvent.click(screen.getByLabelText("إعادة"));
    expect(sendProbe.calls.length).toBe(2);

    // سجّل إيقاف المستخدم على العملية الأحدث: يجب أن ينجو من تنظيف الأقدم المتأخر
    fireEvent.click(screen.getByRole("button", { name: /إيقاف/ }));

    // الآن تصل ردود العملية الأقدم بعد انطلاق الأحدث — يجب أن تُقصى كليًا
    const old = sendProbe.calls[0].cb;
    old.onDelta("t1_" + s.id, "كمشور قديم");
    await waitFor(() => {
      const r1 = useSessionsStore.getState().messages.find((m) => m.id === "r1");
      expect(r1?.text).toBe("أهلاً");
      expect(r1?.status).toBe("done");
    });
    old.onStatus("t1_" + s.id, "error", "خطأ قديم");
    expect(errSpy).not.toHaveBeenCalledWith("خطأ قديم");
    const ghost: import("@/types").ChatMessage = { id: "mGhost", sessionId: s.id, turnId: "trGhost", createdAt: Date.now(), role: "assistant", kind: "result", text: "رسالة متأخرة", targetId: "t1_" + s.id, status: "done" };
    const before = useSessionsStore.getState().messages.length;
    old.onAppended(ghost);
    expect(useSessionsStore.getState().messages).toHaveLength(before);
    old.onDropped(["t1_" + s.id]);
    expect(warnSpy).not.toHaveBeenLastCalledWith(expect.stringContaining("سقطت"));
    // حسم العملية الأقدم: تنظيفها النهائي لا يلمس sending ولا stopped الخاص بالأحدث
    sendProbe.calls[0].resolve();
    await waitFor(() => { void 0; });
    await new Promise((r) => setTimeout(r, 50));
    expect(useSessionsStore.getState().messages.some((m) => m.id === "mGhost")).toBe(false);
    // حارس الإيقاف ما يزال حيًا: ردّ حالة الأحدث يرى stopped → «أُوقف» بلا توست خطأ
    sendProbe.calls[1].cb.onStatus("t1_" + s.id, "error", "ألغي بواسطة المستخدم");
    const r1b = useSessionsStore.getState().messages.find((m) => m.id === "r1");
    expect(r1b?.status).toBe("stopped");
    expect(errSpy).not.toHaveBeenCalledWith("ألغي بواسطة المستخدم");
    // sending ما يزال مفعولًا للأحدث: زر الإيقاف لا زم رس بد
    expect(screen.getByRole("button", { name: /إيقاف/ })).toBeInTheDocument();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  }, 8000);
});
