import { afterEach, describe, expect, it } from "vitest";
import { uiText } from "@/i18n";
import { ar } from "@/i18n/ar";
import { en } from "@/i18n/en";
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

// [T3.2a] العلامات تُقرأ وقت الاستدعاء لا وقت الاستيراد، فتتبع لغة الواجهة النشطة.
describe("redactExternalError locale (T3.2a)", () => {
  afterEach(() => uiText.setLocale("ar"));

  it("يُنتج الفئة العامة والعلامة المقتطعة والمحذوفة بلغة الواجهة النشطة", () => {
    uiText.setLocale("en");
    expect(redactExternalError({ secret: "sk-should-never-appear" })).toBe(en.errors.redactionGeneric);
    expect(redactExternalError("")).toBe(en.errors.redactionGeneric);
    expect(redactExternalError("x".repeat(400))).toContain(en.errors.redactionTruncated);
    expect(redactExternalError("C:\\Users\\name\\secret.json")).toContain(en.errors.redactionMarker);
  });

  it("النسخة العربية مطابقة بايتًا للقيم السابقة", () => {
    expect(ar.errors.redactionGeneric).toBe("خطأ خارجي غير محدد");
    expect(ar.errors.redactionTruncated).toBe("… [مقتطع]");
    expect(ar.errors.redactionMarker).toBe("[محذوف]");
  });
});
// [T7.3] صيغ المفاتيح التي تسمّيها السياسة: كانت جميعها تمرّ بلا حذف قبل هذا التغيير.
describe("redactExternalError provider key formats (T7.3)", () => {
  const google = "AIza" + "A".repeat(35);
  const github = "ghp_" + "b".repeat(36);
  const slack = "xoxb-" + "1234567890-0987654321-abcdefghijklmnop";
  const aws = "AKIA" + "C".repeat(16);

  it("يزيل صيغ Google وGitHub وSlack وAWS أينما ظهرت بلا تسمية", () => {
    const out = redactExternalError([google, github, slack, aws].join(" and "));
    for (const secret of [google, github, slack, aws]) expect(out).not.toContain(secret);
  });

  it("يزيل client_secret رغم أن الشرطة السفلية حرف كلمة لا حدّ كلمة", () => {
    const out = redactExternalError("bad client_secret=abcdef123456 for the app");
    expect(out).not.toContain("abcdef123456");
  });

  it("يزيل قيمة سرّية معروفة لا تطابق أي نمط، فلا يعتمد الأمان على تخمين الصيغة", () => {
    const unknown = "0123456789abcdef0123456789abcdef";
    const out = redactExternalError("provider echoed " + unknown, { secrets: [unknown] });
    expect(out).not.toContain(unknown);
  });

  it("لا يحذف سرًّا أقصر من الحد الأدنى حمايةً لنصّ الرسالة", () => {
    expect(redactExternalError("bad key abc", { secrets: ["abc"] })).toBe("bad key abc");
  });
});
