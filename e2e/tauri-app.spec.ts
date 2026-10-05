import { test, expect } from './fixtures';

const LONGCAT = 'longcat-2.5-preview-free';
const LONGCAT_LABEL = 'LongCat 2.5 Preview (Free)';
const OPENCODE_PROVIDER_LABEL = 'OpenCode Go';

test.describe('Tauri App E2E', () => {
  test.beforeEach(async ({ tauriPage }) => {
    // The first-run onboarding dialog is modal and aria-hides the app behind
    // it. Set the "seen" flag and reload so the app mounts without it. The
    // flag persists in localStorage, so this is a no-op after the first run.
    await tauriPage.evaluate('localStorage.setItem("shura-onboarding-seen", "true")');
    await tauriPage.evaluate('window.location.reload()');
    await new Promise(r => setTimeout(r, 500));
    await tauriPage.waitForFunction('document.readyState === "complete" && !!window.__PW_ACTIVE__');
  });

  test('app loads and shows the main heading', async ({ tauriPage }) => {
    await tauriPage.goto('/');
    await expect(tauriPage.getByRole('heading', { name: 'شورى' })).toBeVisible();
  });

  test('settings dialog opens and closes', async ({ tauriPage }) => {
    await tauriPage.goto('/');
    await tauriPage.getByRole('button', { name: 'الإعدادات' }).click();
    const dialog = tauriPage.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await tauriPage.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('primary model is configured to longcat-2.5-preview-free', async ({ tauriPage }) => {
    await tauriPage.goto('/');
    await tauriPage.getByRole('button', { name: 'الإعدادات' }).click();
    const dialog = tauriPage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Select OpenCode Go provider using the native value setter so React's
    // onChange fires (the plugin's selectOption sets el.value directly, which
    // React's value tracker ignores).
    await tauriPage.evaluate(`(function(){var sel=document.querySelector('select[aria-label="مزود النموذج الأساسي"]');var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(sel,'opencodego');sel.dispatchEvent(new Event('change',{bubbles:true}));})()`);

    // Wait for the model dropdown to populate with the longcat option.
    await tauriPage.waitForFunction(`document.querySelector('select[aria-label="نموذج الموديل الأساسي"] option[value="${LONGCAT}"]')!==null`, 10000);

    // Select the longcat model.
    await tauriPage.evaluate(`(function(){var sel=document.querySelector('select[aria-label="نموذج الموديل الأساسي"]');var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(sel,'${LONGCAT}');sel.dispatchEvent(new Event('change',{bubbles:true}));})()`);

    // Click assign.
    await tauriPage.getByRole('button', { name: 'تعيين' }).click();

    // Verify the primary target is set.
    await expect(dialog.getByText(`الحالي: opencodego · ${LONGCAT}`)).toBeVisible();

    // Close settings.
    await tauriPage.getByRole('button', { name: 'تم' }).click();
    await expect(dialog).toBeHidden();
  });

  test('composer shows longcat-2.5-preview-free and accepts input', async ({ tauriPage }) => {
    await tauriPage.goto('/');
    // Create a new session.
    await tauriPage.getByRole('button', { name: 'جلسة جديدة' }).click();
    // Wait for the composer to appear (session creation is async).
    await tauriPage.waitForFunction(`document.querySelector('[data-composer]')!==null`, 10000);
    // Add the longcat model.
    await tauriPage.getByRole('button', { name: 'إضافة نموذج' }).click();
    const dialog = tauriPage.getByRole('dialog');
    await dialog.getByRole('button', { name: OPENCODE_PROVIDER_LABEL, exact: true }).click();
    await dialog.getByRole('button', { name: LONGCAT_LABEL }).click();
    await expect(dialog).toBeHidden();
    // Verify the model appears in the composer.
    await expect(tauriPage.getByText(`${OPENCODE_PROVIDER_LABEL} · ${LONGCAT}`)).toBeVisible();
    // Verify the composer is visible and accepts input.
    const composer = tauriPage.getByPlaceholder('اكتب سؤالك الموحد للجميع…');
    await expect(composer).toBeVisible();
    // Use the native value setter so React's onChange fires (the driver's
    // fill sets el.value directly, which React's value tracker rejects with
    // "Illegal invocation").
    await tauriPage.evaluate(`(function(){var el=document.querySelector('textarea[placeholder="اكتب سؤالك الموحد للجميع…"]');var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(el,'اختبار');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await tauriPage.waitForFunction(`document.querySelector('textarea[placeholder="اكتب سؤالك الموحد للجميع…"]').value==='اختبار'`, 5000);
  });
});