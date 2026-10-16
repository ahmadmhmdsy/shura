import type { ResourceKey, TextArgs, Translate } from "@/i18n";

/**
 * [T3.2b] خطأ يحمل مفتاح مورد بدل نصّ عربي مكتوب في طبقة المجال.
 *
 * `message` هو المفتاح نفسه لا النصّ المترجَم: السجلّ وأثر الاستدعاء يبقيان قابلين للبحث
 * ولا يصيران فارغين أبدًا، والعرض يُترجَم عند الحدّ بلغة القارئ لا بلغة لحظة الرمي.
 */
export class KeyedError extends Error {
  readonly key: ResourceKey;
  readonly args?: TextArgs;

  constructor(key: ResourceKey, args?: TextArgs) {
    super(key);
    this.name = "KeyedError";
    this.key = key;
    this.args = args;
  }
}

export function isKeyedError(value: unknown): value is KeyedError {
  return value instanceof KeyedError;
}

/**
 * المترجم الوحيد لحدود الخطأ: الخطأ المُفتَّح يُترجَم إلى اللغة النشطة، وما دونه يحتفظ
 * بالرسالة التي يحملها، والقيمة بلا نصّ تعيد موردًا عامًّا فلا يظهر سطح فارغ.
 */
export function errorText(t: Translate, error: unknown): string {
  if (isKeyedError(error)) return t(error.key, error.args);
  return messageOf(error) || t("errors.unexpected");
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}
