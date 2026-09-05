import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  const targets = useComposerStore((s) => s.targets);
  const [pSel, setPSel] = useState<ProviderId>("openrouter");
  const [mSel, setMSel] = useState("");
  // [إصلاح منسق مأذون] التثبيت Math.max على كل ضربة مفتاح كان يفسد الكتابة متعددة الخانات
  // («120» رقمًا رقمًا ⇒ 10 ثم 102 ثم 1020 ثانية تُحفظ صامتة فورًا). حقل مسودة نصية محلية:
  // onChange يحدّث المسودة فقط بلا كتابة مخزن، وonBlur يحللها مرة واحدة — صالحة ⇒
  // setTimeoutMs(بحد أدنى 10ث)؛ غير صالحة ⇒ تصفير المسودة فقط فيستعيد الحقل القيمة الحالية.
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-sura-panel border border-sura-border rounded-xl p-4 w-full max-w-lg max-h-[85vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()} dir="rtl">
        <h2 className="text-lg font-semibold">{ar.settings}</h2>
        <section className="space-y-2">{listProviderIds().map((id) => <ProviderKeyCard key={id} id={id} />)}</section>
        <section className="space-y-2 border-t border-sura-border pt-3">
          <h3 className="text-sm font-medium">{ar.primaryModel}</h3>
          <div className="flex gap-2">
            <select className="bg-sura-bg border border-sura-border rounded p-2 text-sm" value={pSel} onChange={(e) => setPSel(e.target.value as ProviderId)}>
              {listProviderIds().map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
            </select>
            <select className="bg-sura-bg border border-sura-border rounded p-2 text-sm flex-1" value={mSel} onChange={(e) => setMSel(e.target.value)}>
              <option value="">— اختر —</option>
              {PROVIDERS[pSel].staticModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <Button size="sm" disabled={!mSel} onClick={() => void setPrimaryTarget({ providerId: pSel, modelId: mSel })}>تعيين</Button>
          </div>
          {primaryTarget && <p className="text-xs text-sura-muted">الحالي: {primaryTarget.providerId} · {primaryTarget.modelId}</p>}
          {targets.length === 0 && <p className="text-xs text-sura-warn">لم تضف نماذج بعد — الأساسي يُستخدم للخلاصة وللأدوار العادية.</p>}
        </section>
        <section className="space-y-2 border-t border-sura-border pt-3">
          <h3 className="text-sm font-medium">{ar.sessionDir}</h3>
          <div className="flex gap-2">
            <Input readOnly value={sessionRootDir ?? "Documents\\Shura (يعمل داخل تطبيق سطح المكتب)"} className="text-xs" />
            <Button size="sm" variant="outline" disabled>تغيير</Button>
          </div>
          <p className="text-[11px] text-sura-muted">تغيير المسار متاح داخل غلاف سطح المكتب (نافذة اختيار مجلد).</p>
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
      </div>
    </div>
  );
}
