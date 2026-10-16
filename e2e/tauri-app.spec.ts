import { test, expect } from './fixtures';
import { PREVIEW_ORIGIN } from './mock-provider';

// "cdp" mode drives the real WebView2 window and ignores the fixture's devUrl,
// so the spec navigates the window to the preview origin itself. Doing that
// keeps every write these tests make (the onboarding flag, the primary model)
// in that origin's storage instead of the app's own profile, and runs the
// assertions against the current build rather than whatever the running binary
// was compiled with.
const APP_URL = process.env.TAURI_E2E_URL ?? PREVIEW_ORIGIN + '/';

const LONGCAT = 'longcat-2.5-preview-free';
const LONGCAT_LABEL = 'LongCat 2.5 Preview (Free)';
const OPENCODE_PROVIDER_LABEL = 'OpenCode Go';

test.describe('Tauri App E2E', () => {
  test.beforeEach(async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL);
    // The first-run onboarding dialog is modal and aria-hides the app behind
    // it. Set the "seen" flag and reload so the app mounts without it. The
    // flag persists in localStorage, so this is a no-op after the first run.
    await tauriPage.evaluate('localStorage.setItem("shura-onboarding-seen", "true")');
    await tauriPage.evaluate('window.location.reload()');
    await new Promise(r => setTimeout(r, 500));
    // cdp mode has no plugin bridge, so window.__PW_ACTIVE__ (set only by the
    // socket mode's mocks) never exists here. Wait for the app shell instead.
    await tauriPage.waitForFunction('document.readyState === "complete" && !!document.querySelector("main")');
  });

  test('app loads and shows the main heading', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL);
    await expect(tauriPage.getByRole('heading', { name: 'شورى' })).toBeVisible();
  });

  test('settings dialog opens and closes', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL);
    await tauriPage.getByRole('button', { name: 'الإعدادات' }).click();
    const dialog = tauriPage.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await tauriPage.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('primary model is configured to longcat-2.5-preview-free', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL);
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
    await tauriPage.goto(APP_URL);
    // Create a new session. The sidebar's new-session button is the only one
    // that is always present: an untitled session row and the empty-state call
    // to action share this accessible name, so the locator must be explicit.
    await tauriPage.getByRole('button', { name: 'جلسة جديدة' }).first().click();
    // Wait for the composer to appear (session creation is async).
    await tauriPage.waitForFunction(`document.querySelector('[data-composer]')!==null`, 10000);
    // Add the longcat model.
    await tauriPage.getByRole('button', { name: 'إضافة نموذج' }).click();
    const dialog = tauriPage.getByRole('dialog');
    // The provider button carries the "desktop required" badge in its accessible
    // name (opencodego is not browserDirect), so the match must not be exact. The
    // model can also appear once under "recent" and once in the list.
    await dialog.getByRole('button', { name: OPENCODE_PROVIDER_LABEL }).first().click();
    await dialog.getByRole('button', { name: LONGCAT_LABEL }).first().click();
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