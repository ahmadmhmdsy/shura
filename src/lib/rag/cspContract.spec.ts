/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * عقد الأصول والـCSP (المهمة T1.3، القراران D3 وD4، ADR 0004).
 *
 * يفحص هذا الملف ثلاث دعاوى لا تراها اختبارات الوحدة العادية:
 * 1. لا شيء في التطبيق يحمّل كودًا قابلًا للتنفيذ من شبكة (wasm أو عامل):
 *    الأصول التنفيذية تُحزم محليًا عبر ?url، وأي مضيف CDN في src يفشل هنا.
 * 2. كل عنوان مطلق داخل src/lib/rag إمّا مدرج في سماح http:default
 *    (src-tauri/capabilities/default.json - وهو ما يحكم plugin-http في Tauri)
 *    أو في connect-src للـCSP (اتصالات الويب فيو المباشرة). لا يُضاف أصل
 *    تنزيل إلى connect-src لمجرد أن الكود يستعمله.
 * 3. script-src يسمح بتشغيل wasm عبر 'wasm-unsafe-eval' دون فتح eval عام.
 */

const RAG_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(RAG_DIR, "..", "..");
const REPO_ROOT = path.resolve(SRC_DIR, "..");

/**
 * مضيفات CDN التي كانت مصادر التنفيذ القديمة. تُبنى من قطع لئلا يطابق
 * الفحص هذا الملف نفسه عند فحص src (الملفات *.spec مستثناة أصلًا).
 */
const FORBIDDEN_SCRIPT_HOSTS = ["cdn" + ".jsdelivr.net", "unpkg" + ".com", "cdnjs." + "cloudflare.com"];

const SOURCE_EXT = /\.tsx?$/;
const SPEC_EXT = /\.spec\.tsx?$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

/** ملفات الشيفرة المنتَجة فقط: اختبار قد يذكر مضيف CDN بقصد فحصه. */
function sourceFiles(dir: string): string[] {
  return walk(dir).filter((file) => !SPEC_EXT.test(path.basename(file)));
}

const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join("/");

interface TauriConfig {
  app: { security: { csp: string } };
}

interface Capability {
  permissions: (string | { identifier?: string; allow?: { url?: string }[] })[];
}

const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
) as TauriConfig;
const capability = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "src-tauri", "capabilities", "default.json"), "utf8"),
) as Capability;

/** يفصل توجيهات CSP إلى: اسم التوجيه -> قائمة مصادره. */
function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) directives.set(tokens[0], tokens.slice(1));
  }
  return directives;
}

/** أصل عنوان آمن للتحليل؛ يرد null للأنماط غير الشبكية (ipc:, 'self'، غير ذلك). */
function originOf(value: string): string | null {
  try {
    const parsed = new URL(value.replace(/\*+$/, "/"));
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** أصول تنزيل البيانات المسموح بها في الجانب الأصلي (http:default). */
function allowedDataOrigins(): string[] {
  const origins = new Set<string>();
  for (const permission of capability.permissions) {
    if (typeof permission !== "object" || permission === null) continue;
    if (permission.identifier !== "http:default") continue;
    for (const entry of permission.allow ?? []) {
      const origin = entry.url ? originOf(entry.url) : null;
      if (origin) origins.add(origin);
    }
  }
  return [...origins];
}

const csp = parseCsp(tauriConfig.app.security.csp);
const allowedOrigins = new Set<string>([
  ...allowedDataOrigins(),
  ...(csp.get("connect-src") ?? []).map(originOf).filter((o): o is string => o !== null),
]);

/** كل عنوان مطلق شبكي في ملف، مع رقم السطر. */
function absoluteUrls(source: string): { line: number; url: string }[] {
  const found: { line: number; url: string }[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    for (const match of text.matchAll(/https?:\/\/[^\s"'`)>,;]+/g)) {
      found.push({ line: index + 1, url: match[0] });
    }
  });
  return found;
}

describe("عقد أصول RAG وسياسة CSP", () => {
  it("script-src يسمح بتشغيل wasm دون فتح eval عام", () => {
    expect(csp.get("script-src") ?? []).toContain("'wasm-unsafe-eval'");
  });

  it("كل عنوان مطلق في src/lib/rag له سماح موثّق", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(RAG_DIR)) {
      for (const { line, url } of absoluteUrls(fs.readFileSync(file, "utf8"))) {
        const origin = originOf(url);
        if (origin === null) continue;
        if (!allowedOrigins.has(origin)) offenders.push(rel(file) + ":" + line + " " + url);
      }
    }
    expect(
      offenders,
      "عناوين بلا سماح - أضف أصل التنزيل إلى http:default في capabilities/default.json، أو احزم الأصل محليًا عبر ?url",
    ).toEqual([]);
  });

  it("لا يُحمَّل كود قابل للتنفيذ من CDN في أي مكان داخل src", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const source = fs.readFileSync(file, "utf8");
      source.split(/\r?\n/).forEach((text, index) => {
        for (const host of FORBIDDEN_SCRIPT_HOSTS) {
          if (text.includes(host)) offenders.push(rel(file) + ":" + (index + 1) + " " + text.trim());
        }
      });
    }
    expect(offenders, "أصول تنفيذية تبقى مسحوبة من الشبكة").toEqual([]);
  });

  it("الأصول التنفيذية محزومة محليًا عبر ?url", () => {
    const embedder = fs.readFileSync(path.join(RAG_DIR, "embedder.ts"), "utf8");
    const fileProcessor = fs.readFileSync(path.join(RAG_DIR, "fileProcessor.ts"), "utf8");
    expect(embedder).toMatch(/onnxruntime-web\/ort-wasm-simd-threaded\.wasm\?url/);
    expect(embedder).toMatch(/onnxruntime-web\/ort-wasm-simd-threaded\.mjs\?url/);
    expect(fileProcessor).toMatch(/pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url/);
  });
});
