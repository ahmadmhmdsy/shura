import type { ResourceKey, Translate } from "@/i18n";
import { INTERRUPTED_TURN_ERROR } from "@/lib/db/repos/attempts";

/**
 * [T3.1/D6] نصّ الخطأ المخزَّن في صفّ الرسالة عقدٌ محفوظ لا يُترجَم في قاعدة البيانات:
 * تغيير القيمة المخزَّنة هجرة بيانات لا ترجمة. فالترجمة تحدث عند العرض وحده عبر خريطة
 * «القيمة المخزَّنة -> مفتاح مورد»، وما لا تعرفه الخريطة يُعرض كما هو ولا يصير فارغًا.
 *
 * المفتاح يُشتقّ من الثابت `INTERRUPTED_TURN_ERROR` نفسه (مالك واحد للقيمة البايتية)،
 * فلا يتكرّر النصّ العربي في ملف ثانٍ ولا تحتاج الخريطة إلى صيانة عند تغيير القيمة.
 */
/**
 * [T3.2a] قيم الفئة الثانية المخزَّنة قبل أن تصير مفاتيح مورد. تبقى هذه الثوابت مطابقة بايتًا
 * للنسخة العربية (يحرسه `messageError.spec.ts`)، فتظل الصفوف القديمة تُقرأ مترجمة.
 */
const LEGACY_RESULT_SAVE_FAILED = "تعذر حفظ النتيجة الأساسية";
const LEGACY_CALL_CANCELLED = "أُلغي النداء";

const KNOWN_MESSAGE_ERRORS: Readonly<Record<string, ResourceKey>> = {
  [INTERRUPTED_TURN_ERROR]: "errors.interruptedTurn",
  [LEGACY_RESULT_SAVE_FAILED]: "errors.resultSaveFailed",
  [LEGACY_CALL_CANCELLED]: "errors.callCancelled",
};

/**
 * [T3.2b] نوع `t` صار له مالك واحد في `@/i18n`؛ يُعاد تصديره هنا فلا يتغيّر توقيع
 * `messageErrorText` على مستدعيها.
 */
export type { Translate };

/**
 * نصّ الخطأ المعروض لصفّ رسالة: قيمة مخزَّنة معروفة تُترجَم إلى اللغة النشطة، وأي قيمة
 * أخرى تُعاد كما هي، وغياب الخطأ يعيد نصًا فارغًا (لا يخترع رسالة).
 */
export function messageErrorText(t: Translate, stored: string | null | undefined): string {
  if (!stored) return "";
  const key = KNOWN_MESSAGE_ERRORS[stored];
  return key ? t(key) : stored;
}
