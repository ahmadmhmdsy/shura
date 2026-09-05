import type { FetchLike } from "@/lib/providers/registry";

let activeFetch: FetchLike | null = null;

/** تُستدعى من مهام Tauri لربط plugin-http (بلا CORS). في الويب يبقى fetch الافتراضي. */
export function setTransportFetch(f: FetchLike): void { activeFetch = f; }

export function getTransportFetch(): FetchLike {
  return activeFetch ?? globalThis.fetch.bind(globalThis);
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// سطر وحيد أضيف لكود الخطة الحرفي (انحراف موثق): اختبار الخطة نفسه (سطر 1086) يستورد
// testProviderKey من هذا الموديول بينما نسخة transport في الخطة لا تصدّره — الاختبار هو المواصفة.
export { testProviderKey } from "@/lib/providers/keyTest";
