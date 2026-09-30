import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, SessionMeta } from "@/types";
import { downloadFile, exportSessionAsJSON, exportSessionAsMarkdown } from "./sessionExporter";

const session: SessionMeta = {
  id: "ab12cd34",
  title: "سؤال عن المنتج X",
  createdAt: Date.parse("2026-09-05T10:00:00Z"),
  updatedAt: Date.parse("2026-09-05T10:01:00Z"),
  modelIds: ["openai/gpt-4o", "gemini-2.5-pro"],
  primaryTarget: null,
  layoutMode: "vertical",
  onDisk: false,
};

const messages: ChatMessage[] = [
  {
    id: "m1",
    sessionId: "ab12cd34",
    turnId: "t1",
    createdAt: Date.parse("2026-09-05T10:00:30Z"),
    role: "user",
    kind: "prompt",
    text: "ما مميزات المنتج X؟",
    status: "done",
  },
  {
    id: "m2",
    sessionId: "ab12cd34",
    turnId: "t1",
    createdAt: Date.parse("2026-09-05T10:00:45Z"),
    role: "assistant",
    kind: "result",
    text: "المنتج X يتميز بالسرعة والأمان.",
    providerId: "openrouter",
    modelId: "openai/gpt-4o",
    status: "done",
    usage: { inputTokens: 12, outputTokens: 30, cachedInputTokens: 0, costUSD: 0.0003 },
  },
];

describe("exportSessionAsMarkdown", () => {
  it("يكتب عنوان الجسة وكتلة البيانات الوصفية", () => {
    const md = exportSessionAsMarkdown(session, messages);
    expect(md).toContain("# سؤال عن المنتج X");
    expect(md).toContain("ab12cd34");
    expect(md).toContain("2026-09-05T10:00:00.000Z");
    expect(md).toContain("vertical");
    expect(md).toContain("openai/gpt-4o, gemini-2.5-pro");
  });

  it("يكتب قسمًا لكل رسالة مع الدور والنص", () => {
    const md = exportSessionAsMarkdown(session, messages);
    expect(md).toContain("## user");
    expect(md).toContain("## assistant");
    expect(md).toContain("ما مميزات المنتج X؟");
    expect(md).toContain("المنتج X يتميز بالسرعة والأمان.");
  });

  it("يضمّن معلومات النموذج والاستهلاك للرسائل التي تحملها", () => {
    const md = exportSessionAsMarkdown(session, messages);
    expect(md).toContain("openrouter/openai/gpt-4o");
    expect(md).toContain("12 مدخلات");
    expect(md).toContain("30 مخرجات");
    expect(md).toContain("$0.000300");
  });

  it("يتعامل مع قائمة رسائل فارغة ويبقى الترويسة موجودة", () => {
    const md = exportSessionAsMarkdown(session, []);
    expect(md).toContain("# سؤال عن المنتج X");
    expect(md).not.toContain("## user");
  });
});

describe("exportSessionAsJSON", () => {
  it("يُصدر الجلسة والرسائل كائنات JSON كاملة", () => {
    const json = exportSessionAsJSON(session, messages);
    const parsed = JSON.parse(json);
    expect(parsed.session.id).toBe("ab12cd34");
    expect(parsed.session.title).toBe("سؤال عن المنتج X");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1].text).toBe("المنتج X يتميز بالسرعة والأمان.");
    expect(parsed.messages[1].usage.costUSD).toBe(0.0003);
    expect(typeof parsed.exportedAt).toBe("string");
  });

  it("يحافظ على كل حقول الرسالة عند إعادة التسلسل", () => {
    const json = exportSessionAsJSON(session, messages);
    const parsed = JSON.parse(json);
    expect(parsed.messages[0]).toMatchObject({
      id: "m1",
      role: "user",
      kind: "prompt",
      status: "done",
    });
  });
});

describe("downloadFile", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let appendSpy: ReturnType<typeof vi.spyOn>;
  const anchors: HTMLAnchorElement[] = [];

  beforeEach(() => {
    anchors.length = 0;
    // jsdom does not implement URL.createObjectURL/revokeObjectURL.
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const origAppend = document.body.appendChild.bind(document.body);
    appendSpy = vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) anchors.push(node);
      return origAppend(node);
    });
  });

  afterEach(() => {
    appendSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("يُنشئ Blob ويُحمّل الملف عبر رابط ثم يحرره", async () => {
    downloadFile("content", "file.md", "text/markdown");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/markdown");
    expect(await blob.text()).toBe("content");

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("file.md");
    expect(anchors[0].getAttribute("href")).toBe("blob:mock-url");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
