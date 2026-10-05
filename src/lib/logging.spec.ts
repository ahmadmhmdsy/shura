import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLogBuffer,
  getMetrics,
  incrementMessageCount,
  incrementSessionCount,
  initAppLogging,
  log,
  logger,
  markPerformance,
  resetMetrics,
  safeExecute,
  safeExecuteAsync,
  type LogEntry,
} from "./logging";

describe("logging", () => {
  beforeEach(() => {
    resetMetrics();
    vi.restoreAllMocks();
  });

  it("initAppLogging لا يسجّل المستمعينات مرتين عند ندائه مرتين", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    initAppLogging();
    initAppLogging();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom") }));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("initAppLogging يسجّل الخطأ غير المعالج", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom") }));
    expect(errorSpy).toHaveBeenCalledWith("[Shura:ERROR]", "Unhandled error", expect.any(String), " boom");
    errorSpy.mockRestore();
  });

  it("initAppLogging يسجّل رفض الوعد غير المعالج", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: "انفجر" });
    window.dispatchEvent(event);
    expect(errorSpy).toHaveBeenCalledWith("[Shura:ERROR]", "Unhandled promise rejection", ' {"reason":"انفجر"}', "");
    errorSpy.mockRestore();
  });

  it("initAppLogging يسجّل تغيّر وضوح الصفحة", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    document.dispatchEvent(new Event("visibilitychange"));
    expect(debugSpy).toHaveBeenCalledWith("[Shura:DEBUG]", "Page visibility changed", ' {"hidden":false}', "");
    debugSpy.mockRestore();
  });

  it("initAppLogging يسجّل إغلاق التطبيق", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    window.dispatchEvent(new Event("beforeunload"));
    expect(infoSpy).toHaveBeenCalledWith("[Shura:INFO]", "App unloading", expect.any(String), "");
    infoSpy.mockRestore();
  });

  it("log يكتب في المخزن المؤقت ويستدعي console.info للمعلومات", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const before = getLogBuffer().length;
    log("info", "رسالة", { a: 1 });
    expect(infoSpy).toHaveBeenCalledWith("[Shura:INFO]", "رسالة", ' {"a":1}', "");
    const buffer = getLogBuffer();
    expect(buffer).toHaveLength(before + 1);
    expect(buffer[buffer.length - 1]).toMatchObject({ level: "info", message: "رسالة", context: { a: 1 } });
    infoSpy.mockRestore();
  });

  it("log بمستوى error يزيد عدّاد الأخطاء ويسجّل آخر خطأ", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    log("error", "فشل", undefined, new Error("bad"));
    expect(errorSpy).toHaveBeenCalledWith("[Shura:ERROR]", "فشل", "", " bad");
    const metrics = getMetrics();
    expect(metrics.errorCount).toBe(1);
    expect(metrics.lastError?.message).toBe("فشل");
    errorSpy.mockRestore();
  });

  it("المخزن المؤقت يبقى مئة إدخال كحد أقصى", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    for (let i = 0; i < 105; i++) log("info", "رسالة " + i);
    expect(getLogBuffer()).toHaveLength(100);
    infoSpy.mockRestore();
  });

  it("getLogBuffer يعيد نسخة لا تؤثر على المخزن الداخلي", () => {
    const buffer = getLogBuffer();
    const length = buffer.length;
    buffer.push({ timestamp: 0, level: "info", message: "خارجي" } as LogEntry);
    expect(getLogBuffer()).toHaveLength(length);
  });

  it("getMetrics يعيد نسخة لا تؤثر على المقاييس الداخلية", () => {
    const metrics = getMetrics();
    metrics.sessionCount = 999;
    expect(getMetrics().sessionCount).not.toBe(999);
  });

  it("logger.debug/info/warn/error تستدعي log بالمستوى الصحيح", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.debug("تصحيح");
    logger.info("معلومة");
    logger.warn("تحذير");
    logger.error("خطأ", { x: 1 }, new Error("e"));
    expect(debugSpy).toHaveBeenCalledWith("[Shura:DEBUG]", "تصحيح", "", "");
    expect(infoSpy).toHaveBeenCalledWith("[Shura:INFO]", "معلومة", "", "");
    expect(warnSpy).toHaveBeenCalledWith("[Shura:WARN]", "تحذير", "", "");
    expect(errorSpy).toHaveBeenCalledWith("[Shura:ERROR]", "خطأ", ' {"x":1}', " e");
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("markPerformance يسجّل وقت العلامة في المقاييس", () => {
    markPerformance("علامة");
    expect(typeof getMetrics().performanceMarks["علامة"]).toBe("number");
  });

  it("incrementSessionCount و incrementMessageCount يزيدان العدّادين ويحفظانهما", () => {
    incrementSessionCount();
    incrementMessageCount();
    incrementMessageCount();
    const metrics = getMetrics();
    expect(metrics.sessionCount).toBe(1);
    expect(metrics.messageCount).toBe(2);
    const stored = JSON.parse(localStorage.getItem("shura-run-metrics") ?? "{}") as { sessionCount: number; messageCount: number };
    expect(stored.sessionCount).toBe(1);
    expect(stored.messageCount).toBe(2);
  });

  it("resetMetrics يصفّر كل المقاييس", () => {
    incrementSessionCount();
    incrementMessageCount();
    markPerformance("علامة");
    log("error", "خطأ");
    resetMetrics();
    const metrics = getMetrics();
    expect(metrics.sessionCount).toBe(0);
    expect(metrics.messageCount).toBe(0);
    expect(metrics.errorCount).toBe(0);
    expect(metrics.performanceMarks).toEqual({});
  });

  it("safeExecute يعيد نتيجة الدالة ويسجّل علامتي البداية والنهاية", () => {
    const result = safeExecute(() => 42, "سياق");
    expect(result).toBe(42);
    expect(typeof getMetrics().performanceMarks["سياق-start"]).toBe("number");
    expect(typeof getMetrics().performanceMarks["سياق-end"]).toBe("number");
  });

  it("safeExecute يعيد القيمة الاحتياطية عند رمي الخطأ", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = safeExecute(() => { throw new Error("انفجار"); }, "سياق", "احتياطي");
    expect(result).toBe("احتياطي");
    expect(errorSpy).toHaveBeenCalledWith("[Shura:ERROR]", "Error in سياق", ' {"context":"سياق"}', " انفجار");
    errorSpy.mockRestore();
  });

  it("safeExecuteAsync يعيد نتيجة الدالة غير المتزامنة", async () => {
    const result = await safeExecuteAsync(async () => "نجاح", "سياق");
    expect(result).toBe("نجاح");
  });

  it("safeExecuteAsync يعيد القيمة الاحتياطية عند رفض الوعد", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await safeExecuteAsync(async () => { throw new Error("رفض"); }, "سياق", "احتياطي");
    expect(result).toBe("احتياطي");
    errorSpy.mockRestore();
  });

  it("loadMetrics يدمج المقاييس المحفوظة عند أول استخدام", async () => {
    localStorage.setItem("shura-run-metrics", JSON.stringify({ sessionCount: 7, messageCount: 3 }));
    vi.resetModules();
    const fresh = await import("./logging");
    const metrics = fresh.getMetrics();
    expect(metrics.sessionCount).toBe(7);
    expect(metrics.messageCount).toBe(3);
  });
});
