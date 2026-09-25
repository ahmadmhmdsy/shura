import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/state/settingsStore";
import { useComposerStore } from "@/state/composerStore";
import { PROVIDERS, listProviderIds } from "@/lib/providers/registry";
import { ProviderKeyCard } from "./ProviderKeyCard";
import { ar } from "@/i18n/ar";
import type { ProviderId } from "@/types";

export function SettingsScreen({ onClose }: { onClose(): void }) {
  // [انحراف موثق على كود الخطة] حُذف تفكيك providerKeys وsetSessionRootDir — غير مستخدمين في متن
  // المكون، وnoUnusedLocals يُفشل السلسلة بهما (الدرس نفسه المطبق في المهمة 11: sessionFolderName).
  const { primaryTarget, setPrimaryTarget, sessionRootDir, timeoutMs, setTimeoutMs, load } = useSettingsStore();
  // لا سطح مؤلف شامل بعد الخطوة 5: يكفي وجود هدف واحد في أي مسودة جلسة لصمت تحذير «لم تضف نماذج بعد»
  const hasAnyTargets = useComposerStore((s) => Object.values(s.drafts).some((d) => d.targets.length > 0));
  const [pSel, setPSel] = useState<ProviderId>("openrouter");
  const [mSel, setMSel] = useState("");
  // [إصلاح منسق مأذون] التثبيت Math.max على كل ضربة مفتاح كان يفسد الكتابة متعددة الخانات
  // («120» رقمًا رقمًا ⇒ 10 ثم 102 ثم 1020 ثانية تُحفظ صامتة فورًا). حقل مسودة نصية محلية:
  // onChange يحدّث المسودة فقط بلا كتابة مخزن، وonBlur يحللها مرة واحدة — صالحة ⇒
  // setTimeoutMs(بحد أدنى 10ث)؛ غير صالحة ⇒ تصفير المسودة فقط فيستعيد الحقل القيمة الحالية.
  const selectProvider = (next: ProviderId) => { setPSel(next); setMSel(""); };
  const invalidPrimary = primaryTarget != null && !PROVIDERS[primaryTarget.providerId]?.staticModels.some((m) => m.id === primaryTarget.modelId);
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);
  // The opener must be captured during render, not in an effect: Radix focuses the dialog
  // content in a mount effect, so by the time a useEffect runs the active element is
  // already inside the dialog and focus would return to body instead of the trigger.
  const openerRef = useRef<Element | null>(null);
  if (openerRef.current === null) openerRef.current = document.activeElement;
  useEffect(() => () => (openerRef.current as HTMLElement | null)?.focus(), []);


  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl" closeLabel="إغلاق">
        <DialogHeader>
          <DialogTitle>{ar.settings}</DialogTitle>
          <DialogDescription className="sr-only">إعدادات المزودين والنموذج الأساسي والمجلد والمهلة</DialogDescription>
        </DialogHeader>
        <section className="space-y-2">{listProviderIds().map((id) => <ProviderKeyCard key={id} id={id} />)}</section>
        <section className="space-y-2 border-t border-sura-border pt-3">
          <h3 className="text-sm font-medium">{ar.primaryModel}</h3>
          <div className="flex gap-2">
            <select aria-label="مزود النموذج الأساسي" className="bg-sura-bg border border-sura-border rounded p-2 text-sm" value={pSel} onChange={(e) => selectProvider(e.target.value as ProviderId)}>
              {listProviderIds().map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
            </select>
            <select className="bg-sura-bg border border-sura-border rounded p-2 text-sm flex-1" value={mSel} onChange={(e) => setMSel(e.target.value)}>
              <option value="">— اختر —</option>
              {PROVIDERS[pSel].staticModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <Button size="sm" disabled={!mSel} onClick={() => void setPrimaryTarget({ providerId: pSel, modelId: mSel })}>تعيين</Button>
          </div>
          {primaryTarget && invalidPrimary && <p role="alert" className="text-xs text-sura-warn">النموذج المحفوظ غير صالح: هذا الموديل لا ينتمي إلى المزود المختار.</p>}
          {primaryTarget && !invalidPrimary && <p className="text-xs text-sura-muted">الحالي: {primaryTarget.providerId} · {primaryTarget.modelId}</p>}
          {!hasAnyTargets && <p className="text-xs text-sura-warn">لم تضف نماذج بعد — الأساسي يُستخدم للخلاصة وللأدوار العادية.</p>}
        </section>
        <section className="space-y-2 border-t border-sura-border pt-3">
          <h3 className="text-sm font-medium">{ar.sessionDir}</h3>
          {/* [دور إصلاح مأذون — بند 2 من المراجعة الختامية] الزر «تغيير» المعطل ووعد «نافذة اختيار
              مجلد» حذفا (قرار منسق): الاختيار خارج نطاق capabilities وسيُحجب بصمت — النص الصادق
              بديلًا عن الوعد، والمدخل للعرض فقط يبقى. */}
          <Input readOnly value={sessionRootDir ?? "Documents\\Shura (يعمل داخل تطبيق سطح المكتب)"} className="text-xs" />
          <p className="text-[11px] text-sura-muted">المسار ثابت في هذه النسخة: Documents\Shura</p>
        </section>
        <section className="space-y-2 border-t border-sura-border pt-3">
          <h3 className="text-sm font-medium">{ar.timeout}</h3>
          <Input type="number" min={10} value={timeoutDraft ?? String(Math.round(timeoutMs / 1000))}
            onChange={(e) => setTimeoutDraft(e.target.value)}
            onBlur={() => {
              if (timeoutDraft === null) return;
              const v = Number(timeoutDraft);
              if (timeoutDraft.trim() !== "" && Number.isFinite(v)) void setTimeoutMs(Math.max(10, Math.round(v)) * 1000);
              setTimeoutDraft(null);
            }}
            className="w-32" />
        </section>
        <div className="flex justify-end gap-2 border-t border-sura-border pt-3">
          <Button size="sm" onClick={() => { void load(); onClose(); }}>تم</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}