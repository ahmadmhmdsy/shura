import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useUiText } from "@/i18n";

const ONBOARDING_SEEN_KEY = "shura-onboarding-seen";

const ONBOARDING_STEP_KEYS = [
  { title: "onboarding.step1Title", desc: "onboarding.step1Desc" },
  { title: "onboarding.step2Title", desc: "onboarding.step2Desc" },
  { title: "onboarding.step3Title", desc: "onboarding.step3Desc" },
] as const;

/** True once the user has finished or skipped the first-run wizard. */
export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
}

/** Persists the "seen" flag. Exported so the owner decides when onboarding is done. */
export function markOnboardingSeen(): void {
  localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
}

/**
 * Three-step first-run wizard. Owns its step index; the parent owns only whether the
 * wizard is shown and the durable "seen" flag, so no wizard state leaks into App.
 */
export function OnboardingDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useUiText();
  const [step, setStep] = useState(0);
  const steps = ONBOARDING_STEP_KEYS.map((entry) => ({ title: t(entry.title), desc: t(entry.desc) }));
  // Closing via the overlay/escape and via "تم" resets the step; the skip/example
  // buttons intentionally do not, matching the original wizard semantics.
  const finish = useCallback(() => {
    onClose();
    setStep(0);
  }, [onClose]);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) finish(); }}>
      {/* The X is the skip action here, so it keeps the same wording as the skip button. */}
      <DialogContent className="max-w-md" closeLabel={t("onboarding.skip")}>
        <DialogHeader>
          <DialogTitle>{t("onboarding.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("onboarding.whatIsShuraDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {steps.map((entry, index) => index === step ? (
            <div key={entry.title} className="space-y-2">
              <h3 className="text-[length:var(--sura-text-h4)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">{entry.title}</h3>
              <p className="text-[length:var(--sura-text-body-sm)] text-[var(--sura-text-secondary)]">{entry.desc}</p>
            </div>
          ) : null)}
          {/* Step indicators */}
          <div className="flex justify-center gap-2 pt-2" aria-label={t("onboarding.step", { step: step + 1, total: steps.length })}>
            {steps.map((entry, index) => (
              <button
                key={entry.title}
                type="button"
                className={"size-2 rounded-[var(--sura-radius-full)] transition-colors " + (index === step ? "bg-[var(--sura-accent-primary)]" : "bg-[var(--sura-border-primary)]")}
                onClick={() => setStep(index)}
                aria-label={t("onboarding.stepOf", { step: index + 1 })}
                aria-current={index === step ? "true" : undefined}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{t("onboarding.skip")}</Button>
            <Button variant="outline" onClick={onClose}>{t("onboarding.tryExample")}</Button>
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>{t("onboarding.back")}</Button>
            )}
            {step < steps.length - 1
              ? <Button onClick={() => setStep(step + 1)}>{t("onboarding.next")}</Button>
              : <Button onClick={finish}>{t("onboarding.done")}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
