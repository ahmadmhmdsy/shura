import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ar } from "@/i18n/ar";

const ONBOARDING_SEEN_KEY = "shura-onboarding-seen";

const ONBOARDING_STEPS = [
  { title: ar.onboardingStep1Title, desc: ar.onboardingStep1Desc },
  { title: ar.onboardingStep2Title, desc: ar.onboardingStep2Desc },
  { title: ar.onboardingStep3Title, desc: ar.onboardingStep3Desc },
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
  const [step, setStep] = useState(0);
  // Closing via the overlay/escape and via "تم" resets the step; the skip/example
  // buttons intentionally do not, matching the original wizard semantics.
  const finish = useCallback(() => {
    onClose();
    setStep(0);
  }, [onClose]);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) finish(); }}>
      <DialogContent className="max-w-md" dir="rtl" closeLabel={ar.onboardingSkip}>
        <DialogHeader>
          <DialogTitle>{ar.onboardingTitle}</DialogTitle>
          <DialogDescription className="sr-only">{ar.whatIsShuraDesc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {ONBOARDING_STEPS.map((entry, index) => index === step ? (
            <div key={entry.title} className="space-y-2">
              <h3 className="text-[var(--sura-text-h4)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">{entry.title}</h3>
              <p className="text-[var(--sura-text-body-sm)] text-[var(--sura-text-secondary)]">{entry.desc}</p>
            </div>
          ) : null)}
          {/* Step indicators */}
          <div className="flex justify-center gap-2 pt-2" aria-label={"الخطوة " + (step + 1) + " من 3"}>
            {ONBOARDING_STEPS.map((entry, index) => (
              <button
                key={entry.title}
                type="button"
                className={"size-2 rounded-[var(--sura-radius-full)] transition-colors " + (index === step ? "bg-[var(--sura-accent-primary)]" : "bg-[var(--sura-border-primary)]")}
                onClick={() => setStep(index)}
                aria-label={"الخطوة " + (index + 1)}
                aria-current={index === step ? "true" : undefined}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{ar.onboardingSkip}</Button>
            <Button variant="outline" onClick={onClose}>{ar.onboardingTryExample}</Button>
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>{ar.onboardingBack}</Button>
            )}
            {step < ONBOARDING_STEPS.length - 1
              ? <Button onClick={() => setStep(step + 1)}>{ar.onboardingNext}</Button>
              : <Button onClick={finish}>{ar.onboardingDone}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
