// واجهة اختبار المفاتيح: إعادة تصدير من طبقة النقل (التنفيذ الوحيد في transport.ts).
// المسار مثبت بالموجزات اللاحقة: المهمة 8 تستورد mapProviderError من هنا، والمهمة 12
// تستورد testProviderKey من هنا، واختبار المهمة 7 يستوردهما من @/lib/transport/transport.
export { testProviderKey, mapProviderError } from "@/lib/transport/transport";
export type { KeyTestResult } from "@/lib/transport/transport";
