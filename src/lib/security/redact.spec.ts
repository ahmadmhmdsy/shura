import { describe, expect, it } from "vitest";
import { codePointLength, redactExternalError } from "./redact";

describe("redactExternalError", () => {
  it("يزيل مفاتيح الواجهة وAuthorization وJWT ومعاملات الاستعلام", () => {
    const raw = [
      "HTTP 401 Authorization: Bearer sk-or-v1-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      "api_key=sk-abcdefghijklmnopqrstuvwxyz0123456789",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.9zH8Kq3v0mA1bC2dE4fG5hJ6kL7nP8qR",
      "https://api.example.com/v1/chat?api_key=sk-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz&model=x",
    ].join(" ");
    const out = redactExternalError(raw);
    expect(out).not.toMatch(/sk-or-v1-ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
    expect(out).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz/);
    expect(out).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
    expect(out).not.toMatch(/9zH8Kq3v0mA1bC2dE4fG5hJ6kL7nP8qR/);
    expect(out).not.toMatch(/api_key=sk-/);
    expect(out).not.toMatch(/Bearer\s+sk-/i);
  });

  it("يزيل مسارات ويندوز وUNC والمسارات المطلقة وبيت المستخدم", () => {
    const out = redactExternalError([
      "ENOENT: C:\\Users\\name\\Shura\\sessions\\s1\\meta.json",
      "\\\\server\\share\\Shura\\sessions\\s1",
      "/home/name/.config/Shura/credentials.json",
    ].join(" | "));
    expect(out).not.toContain("Users");
    expect(out).not.toContain("server");
    expect(out).not.toContain("/home/");
    expect(out).not.toContain("credentials.json");
  });

  it("يقتطع عند 240 نقطة ترميز افتراضيًا دون قطع زوج بديل", () => {
    const out = redactExternalError("😀".repeat(400));
    expect(codePointLength(out)).toBeLessThanOrEqual(240);
    expect(codePointLength(out)).toBe(240);
    expect(out).not.toContain("\uFFFD");
    expect([...out].slice(-1).join("")).not.toBe("\uD83D");
  });

  it("يقبل حدًا أعلى صريحًا للأرشيف مع إبقاء الافتراضي 240", () => {
    const raw = "ب".repeat(900);
    expect(codePointLength(redactExternalError(raw))).toBe(240);
    expect(codePointLength(redactExternalError(raw, { maxCodePoints: 512 }))).toBe(512);
  });

  it("يعيد فئة عامة آمنة بدل جسم غير آمن أو محتوى استجابة طويل", () => {
    expect(redactExternalError({ secret: "sk-should-never-appear" })).toBe("خطأ خارجي غير محدد");
    const body = JSON.stringify({ choices: [{ message: { content: "x".repeat(500) } }] });
    const out = redactExternalError("provider returned " + body);
    expect(out).not.toContain("choices");
  });

  it("يطبّع الضوضاء ويحتفظ بخطأ عربي عادي", () => {
    expect(redactExternalError("انقطع   الاتصال\n\tبالشبكة")).toBe("انقطع الاتصال بالشبكة");
    expect(redactExternalError("")).toBe("خطأ خارجي غير محدد");
  });

  it("لا يحتفظ بأسباب الكائن ولا يستدعي toString على كائن غير آمن", () => {
    const hostile = {
      toString() { throw new Error("boom"); },
      message: "leaked",
    };
    expect(() => redactExternalError(hostile)).not.toThrow();
    expect(redactExternalError(hostile)).toBe("خطأ خارجي غير محدد");
    const err = Object.assign(new Error("فشل الطلب"), { cause: "sk-cause-secret-value-123456" });
    expect(redactExternalError(err)).not.toContain("sk-cause-secret");
  });
});
