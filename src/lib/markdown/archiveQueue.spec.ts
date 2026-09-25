import { describe, expect, it } from "vitest";
import { archiveQueueDepth, runExclusiveInArchive } from "./archiveQueue";

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runExclusiveInArchive", () => {
  it("يسلسل عمليات المجلد نفسه دون فقد أي عملية", async () => {
    const order: string[] = [];
    const first = runExclusiveInArchive("sessions/a", async () => {
      order.push("a1:start");
      await later(20);
      order.push("a1:end");
    });
    const second = runExclusiveInArchive("sessions/a", async () => {
      order.push("a2:start");
      order.push("a2:end");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["a1:start", "a1:end", "a2:start", "a2:end"]);
    expect(archiveQueueDepth()).toBe(0);
  });

  it("يسمح لمجلدات مختلفة بالتقدم معًا", async () => {
    const order: string[] = [];
    const a = runExclusiveInArchive("sessions/slow", async () => {
      order.push("slow:start");
      await later(30);
      order.push("slow:end");
    });
    const b = runExclusiveInArchive("sessions/fast", async () => {
      order.push("fast:start");
      order.push("fast:end");
    });
    await Promise.all([a, b]);
    expect(order.indexOf("fast:end")).toBeLessThan(order.indexOf("slow:end"));
  });

  it("فشل عملية لا يسمّم السلسلة التالية", async () => {
    const order: string[] = [];
    const failed = runExclusiveInArchive("sessions/b", async () => {
      order.push("b1");
      throw new Error("فشل مقصود");
    });
    const next = runExclusiveInArchive("sessions/b", async () => {
      order.push("b2");
    });
    await expect(failed).rejects.toThrow("فشل مقصود");
    await expect(next).resolves.toBeUndefined();
    expect(order).toEqual(["b1", "b2"]);
    expect(archiveQueueDepth()).toBe(0);
  });

  it("يوحّد المسارات المتكافئة إلى مفتاح واحد", async () => {
    const order: string[] = [];
    const a = runExclusiveInArchive("sessions/c/", async () => {
      order.push("a:start");
      await later(20);
      order.push("a:end");
    });
    const b = runExclusiveInArchive("sessions/c", async () => {
      order.push("b:start");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });
});
