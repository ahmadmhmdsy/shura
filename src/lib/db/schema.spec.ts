import { describe, expect, it } from "vitest";
import { db } from "./db";

/**
 * كل استعلام ‎db.<جدول>.where("حقل")‎ في شيفرة الإنتاج يجب أن يقابله فهرس معلن
 * في db.ts.
 *
 * سبب وجود هذا الاختبار: مخطط rag_documents لم يكن يفهرس "persistence" بينما
 * أربع دوال إنتاجية تستعلم به، فكان كل مسار لتنظيف الملفات المؤقتة يرمي
 *   SchemaError: KeyPath persistence on object store rag_documents is not indexed
 * وهو خطأ لا تكشفه الأنواع ولا المراجعة اليدوية، بل التشغيل فقط. الاختبار يقرأ
 * الشيفرة الفعلية، فلا يعتمد على قائمة يدوية تتقادم.
 *
 * النصوص تُجمع عبر «import.meta.glob» وقت الترجمة لا عبر «node:fs»: إعداد
 * «tsconfig.json» يحصر «types» في «vite/client»، فاستيراد وحدات node يفشل في tsc.
 */
const RAW_SOURCES = import.meta.glob("../../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface Query {
  table: string;
  field: string;
  file: string;
}

function queriedFields(): Query[] {
  const found: Query[] = [];
  const pattern = /db\.(\w+)\s*\.where\(\s*"([^"]+)"\s*\)/g;
  for (const [file, text] of Object.entries(RAW_SOURCES)) {
    if (/\.spec\./.test(file)) continue;
    for (const match of text.matchAll(pattern)) {
      found.push({ table: match[1], field: match[2], file: file.replace(/^\.\.\/\.\.\//, "src/") });
    }
  }
  return found;
}

/** الفهارس المعلنة لجدول، بصيغة "keyPath" المفردة أو المركّبة "a+b". */
function indexedKeyPaths(table: string): string[] | null {
  const store = (db as unknown as Record<string, { schema?: { indexes: Array<{ keyPath: string | string[] }> } }>)[table];
  if (!store?.schema) return null;
  return store.schema.indexes.map((i) => (Array.isArray(i.keyPath) ? i.keyPath.join("+") : i.keyPath));
}

describe("فهارس مخطط Dexie مقابل استعلامات الإنتاج", () => {
  const queries = queriedFields();

  it("يجد استعلامات فعلية (حتى لا يمرّ الاختبار فارغًا)", () => {
    expect(queries.length).toBeGreaterThan(10);
  });

  it("كل حقل يُستعلم عنه في الإنتاج مفهرس في جدوله", () => {
    const problems = queries
      .map(({ table, field, file }) => {
        const indexed = indexedKeyPaths(table);
        if (indexed === null) return `${table}.${field}: لا جدول بهذا الاسم (${file})`;
        if (!indexed.includes(field)) {
          return `${table}.${field} غير مفهرس (${file}) — الفهارس: ${indexed.join(", ")}`;
        }
        return null;
      })
      .filter((p): p is string => p !== null);

    expect(problems).toEqual([]);
  });
});
