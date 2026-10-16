/**
 * [T4.2] سقف أسطر ملفات `src/features/chat`: يحرس ما حققه T4.1 فيمنع عودة `ChatScreen.tsx`
 * إلى الحجم الذي استُخرج منه. العدّ بـ `split(/\r?\n/).length` ليطابق ما تعدّه أدوات
 * الجلسة (أداة قراءة الملفات و`Get-Content`)، فلا يختلف الرقم بين الحرس والتوثيق.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** الميزانية الافتراضية لوحدة إنتاجية واحدة. */
const DEFAULT_BUDGET = 500;
/** ميزانية ملفات الاختبار: أعلى لأن اختبار شاشة كاملًا يطول، ومع ذلك يمنع النمو الأعمى. */
const SPEC_BUDGET = 600;
/**
 * سقوف صريحة للاستثناءات المسجَّلة: ليست أهدافًا بل حدود عليا. كل رقم = المقيس عند التسجيل
 * (2026-10-12) + هامش صغير كي لا يكسر تعديل سطر واحد البناء، فالنمو محصور مع ذلك. تُخفَّض عند
 * كل استخراج ولا تُرفع إلا بقرار موثَّق في `docs/plans/2026-10-05-production-readiness-progress.md`.
 * `ChatScreen.tsx` وحده دون الافتراضية لأنه يحمل رقم قبول T4.1 نفسه.
 */
const CEILINGS: Record<string, number> = {
  "ChatScreen.tsx": 400,
  "ChatScreen.spec.tsx": 1450,
};

interface FileSize {
  file: string;
  lines: number;
}

function ceiling(file: string): number {
  const recorded = CEILINGS[file];
  if (recorded !== undefined) return recorded;
  if (/\.spec\.tsx?$/.test(file)) return SPEC_BUDGET;
  return DEFAULT_BUDGET;
}

function scan(dir: string, prefix = ""): FileSize[] {
  const out: FileSize[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...scan(path.join(dir, entry.name), rel));
    else if (/\.tsx?$/.test(entry.name)) {
      out.push({ file: rel, lines: readFileSync(path.join(dir, entry.name), "utf8").split(/\r?\n/).length });
    }
  }
  return out;
}

function violations(entries: FileSize[]): string[] {
  return entries
    .filter((entry) => entry.lines > ceiling(entry.file))
    .map((entry) => entry.file + ": " + entry.lines + " lines (budget " + ceiling(entry.file) + ")");
}

describe("ميزانية أسطر ملفات الدردشة (T4.2)", () => {
  it("كل ملف تحت src/features/chat داخل ميزانيته", () => {
    const over = violations(scan(ROOT));
    const hint = "استخرج وحدة أو اختبر الجزء الجديد في ملف آخر بدل رفع الرقم:\n";
    expect(over, over.length > 0 ? hint + over.join("\n") : "").toEqual([]);
  });

  it("الفحص يُطلق على الميزانية الافتراضية وميزانية الاختبارات والسقف الصريح", () => {
    const over = violations([
      { file: "NewModule.tsx", lines: DEFAULT_BUDGET },
      { file: "TooBig.tsx", lines: DEFAULT_BUDGET + 1 },
      { file: "Big.spec.tsx", lines: SPEC_BUDGET },
      { file: "TooBig.spec.tsx", lines: SPEC_BUDGET + 1 },
      { file: "ChatScreen.tsx", lines: ceiling("ChatScreen.tsx") },
      { file: "ChatScreen.tsx", lines: ceiling("ChatScreen.tsx") + 1 },
    ]);
    expect(over).toContain("TooBig.tsx: " + (DEFAULT_BUDGET + 1) + " lines (budget " + DEFAULT_BUDGET + ")");
    expect(over).toContain("TooBig.spec.tsx: " + (SPEC_BUDGET + 1) + " lines (budget " + SPEC_BUDGET + ")");
    expect(over).toContain("ChatScreen.tsx: " + (ceiling("ChatScreen.tsx") + 1) + " lines (budget " + ceiling("ChatScreen.tsx") + ")");
    expect(over).toHaveLength(3);
  });
});
