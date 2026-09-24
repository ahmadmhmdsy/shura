// [أداة احتياطية لكتابة node:fs] المشروع لا يضم @types/node (types: ["vite/client"])،
// والاختبارات التي تقرأ ملفات محلية (موجز المهمة 2: capabilities/default.json)
// تحتاج الشكل الفعلي فقط لـ readFileSync في بيئة Vitest على Node.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
