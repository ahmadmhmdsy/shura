# سجل بيئة التنفيذ الفعلية — «شورى»

- **التاريخ:** توثيق ختامي عند اكتمال المهام 1-15 (المهمة 15 — التحقق النهائي).
- **النطاق:** بيئة الجهاز التي نُفِّذ عليها MVP فعلًا، بما فيها عيوب بيئة البناء ووصفة إعادة الدخول للبناء.

## 1. الجهاز ونظام التشغيل

- نظام التشغيل: **Windows 11 Pro 25H2** — الهوية من السجل: `DisplayVersion`=25H2 و`CurrentBuild`=26200 (UBR 0x23d0)؛ بينما `ProductName` يحمل «Windows 10 Pro» — بقايا تاريخية معروفة لم تُحدّثها مايكروصوفت على ويندوز 11، وويندوز 10 توقف عند 22H2.
- بناء سطح المكتب موجه لهدف `x86_64-pc-windows-msvc`.

## 2. الأدوات المثبتة (قيم فعلية وقت التوثيق)

| الأداة | النسخة الفعلية | ملاحظة |
|---|---|---|
| Node.js | **v24.18.0** | مطابق لشرط Node 24+ |
| pnpm | **11.25.0** | نص الخطة ذكر 11.7.0؛ `package.json` devEngines يشترط `^11.7.0` — **محقق** مع 11.25.0 |
| rustc | **1.98.0 (88d9e12ae 2026-08-18)** | ناتج `rustc --version` الفعلي |
| cargo | **1.98.0 (797e8a9bc 2026-08-05)** | ناتج `cargo --version` الفعلي |
| WebView2 Runtime | **152.0.4191.66 (Evergreen)** | متوفر — من السجل `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` |

## 3. مساحة القرص (وقت التوثيق)

| القرص | المتاح |
|---|---|
| **E:** (قرص المستودع) | **17.8 GB** |
| C: | 45.4 GB |

## 4. نتائج فحوص CORS الأربعة — **منقولة نصًّا من وثيقة التصميم** §4.3

> المصدر: `docs/superpowers/specs/2026-09-05-shura-app-design.md` — بتاريخ 2026-09-05.
> **تنويه صادق:** هذه النتائج **اقتباس من الوثيقة المعتمدة، ولم يُعَد تنفيذ أي فحص شبكي** في المهمة 15 (خارج نطاقها).

| المزود | نداء المتصفح المباشر |
|---|---|
| OpenRouter `https://openrouter.ai/api/v1` | ✅ مفتوح (Access-Control-Allow-Origin: *) |
| Gemini `https://generativelanguage.googleapis.com` | ✅ مفتوح |
| MiniMax `https://api.minimax.io` | ✅ مفتوح (يُعاد التحقق بنداء فعلي في المرحلة 0) |
| OpenCode Go `https://opencode.ai/zen/go/v1` | ❌ محجوب (OPTIONS: 404 بلا ترويسات CORS؛ POST: 401 بلا ترويسات) |

**القاعدة المعتمدة في التصميم:** طبقة `Transport` واحدة بواجهة موحدة؛ داخل المتصفح `fetch`، وداخل Tauri إضافة `http` الأصلية (بلا قيود CORS). في وضع الويب الخالص، المزود المحجوب يظهر بحالة «يتطلب تطبيق سطح المكتب» بدل فشل صامت.

## 5. عيوب بيئة بناء Rust على هذا الجهاز (موثقة بأدلة في تقرير المهمة 14)

**المشكلة الجذرية — تعدد مجموعات MSVC واختيار rustc للرابط القديم:**

- `rustc` يختار تلقائيًا `link.exe` **14.16.27023 (VC2017)** من ضمن المجموعات المثبتة في `C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC` — المجموعات كلها: 14.16.27023، 14.29.30133، 14.36.32532، 14.38.33130، 14.40.33807، **14.42.34433**.
- الرابط القديم 14.16 يفشل بـ **LNK2001: unresolved external symbol `__guard_eh_cont_table`/`__guard_eh_cont_count`** (لا يعالج `/alternatename` الافتراضية في msvcrt.lib الحديث — الدليل الحاسم من تقرير المهمة 14: `cl /MD hello.c` تحت vcvars64 نفسه ينجح، وrustc بممرر الرابط 14.42 ينجح، ومسح `dumpbin /linkermember` على مكتبات 14.42 وSDK: لا واحد يعرّف الرمزين).
- محاولة أولى فشلت بـ **LNK1181: cannot open input file 'kernel32.lib'** — Windows Kits يضم نسختين: **10.0.10240.0 ناقصة** (بلا `um\x64\kernel32.lib`) و**10.0.22621.0 كاملة**؛ وrustc وحده لم يمسك الصحيحة.

**النتائج تحت الوصفة الصحيحة (تقرير المهمة 14):**

- `cargo check` (داخل `src-tauri`): **PASS** (exit 0).
- `pnpm tauri build`: البناء الصدري **PASS** (`src-tauri\target\release\app.exe`، release ~4m) — حزم **NSIS PASS**: `src-tauri\target\release\bundle\nsis\shura_0.1.0_x64-setup.exe`.
- هدف **MSI FAIL**: `light.exe` من WiX 3 لا يعمل — **WiX 3 يتطلب .NET Framework 3.5، غير المتوفر على هذا الجهاز** (تثبيته خارج نطاق المهام؛ استخدم NSIS).
- **لا يوجد `config.toml` بمسارات مطلقة في المستودع عمدًا** — الوصفة متغيرات بيئة لكل استدعاء حتى لا تكسر أجهزة أخرى.

## 6. خطوات إعادة الدخول للبناء (سطح المكتب) على هذا الجهاز

1. `pnpm install`
2. **ويب فقط؟** لا حاجة لما يلي: `pnpm dev` / `pnpm build` يكفيان (لا Rust).
3. افتح بيئة أدوات x64: **"x64 Native Tools Command Prompt for VS 2022"** (أو نافذة عادية ثم شغّل `vcvars64.bat`) — لا بد لأن rustc وحده يمسك الرابط القديم 14.16.
4. وجّه الرابط إلى مجموعة 14.42 (مسارها **متحقق من وجوده**):

   ```powershell
   $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.42.34433\bin\Hostx64\x64\link.exe"
   ```

5. ثم:
   - تطوير: `pnpm tauri dev`
   - بناء + حزمة تثبيت: `pnpm tauri build --bundles nsis` — **تجنّب هدف MSI الافتراضي (all)** حتى يتوفر .NET 3.5.

## 7. الحالات غير المتحققة على هذا الجهاز (صادقة)

- `pnpm tauri dev` داخل **نافذة حية**، اختبار **مفتاح مزود حقيقي**، و**كتابة فعلية** تحت `Documents\Shura\sessions`: **SKIPPED — متطلب بشري (بيئة بلا GUI تفاعلي)** في المهمتين 14 و15. الوصلات (plugin-http، الحوض المتجذر، النطاق `$DOCUMENTS/Shura/**`) تحققت من مصادر المكونات ومن `cargo check`، لكن لا دليل تشغيلي حي.

## 8. السلسلة الرباعية النهائية (المهمة 15)

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` → **CHAIN_ALL_PASS (exit 0)**

| الأمر | النتيجة |
|---|---|
| `pnpm typecheck` (tsc --noEmit) | PASS |
| `pnpm lint` (eslint .) | PASS |
| `pnpm test` (vitest run) | **PASS — 87/87 اختبارًا (18 ملفًا)، Duration ~10.1s** (سجل المهمة 15؛ السلسلة الأخيرة قبل الدمج: 92/92 عبر 18 ملفًا — انظر سجل ما بعد المراجعة الشاملة) |
| `pnpm build` (tsc --noEmit && vite build) | PASS — vite 8.2.2، `dist` مُنتج |

- التحذيرات القديمة المعلومة بلا مساس صحيح: `act(...)` في `ChatScreen.spec.tsx` (موثقة منذ المهمة 13)، وتحذيرا Vite (`configLoader: 'native'`/`__dirname`، وحجم chunk أكبر من 500kB) — لم يزد شيء.
- بلا شبكة في الاختبارات؛ `git status` نظيف قبل كتابة وثائق هذه المهمة.

## 8. بوابة الإصدار (المهمة 11) — ما هي وما نتيجتها

أوامر البوابة المضافة في `package.json`:

| الأمر | ما يفعله |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` ثم `tsc --noEmit -p tsconfig.node.json` (المشروع الثاني يشمل `vite.config.ts` و`playwright.config.ts` و`e2e/**`) |
| `pnpm lint` | `eslint .` على الشيفرة فقط (dist و coverage و test-results مستثناة) |
| `pnpm test:coverage` | Vitest + تغطية v8 بعتبة 80/75/80/80 |
| `pnpm build` | فحص الأنواع ثم `vite build` |
| `pnpm check:all` | typecheck + lint + coverage + build |
| `pnpm test:e2e` | Playwright (Chromium) على بناء الإنتاج عبر منفذ preview ثابت 4317 |
| `pnpm tauri:build:windows` | `pnpm tauri build --bundles nsis` |

**أدوات البوابة المثبتة:** `@playwright/test` 1.63.0، `@axe-core/playwright` 4.13.0،
`@vitest/coverage-v8` 5.0.1، `@types/node` 26.6.2. متصفح Chromium (playwright v1243 /
Chrome for Testing 153.0.8010.12) كان موجودًا في `%LOCALAPPDATA%\ms-playwright` فلم يحتج تحميلًا جديدًا.

**نتائج مقيسة فعلًا على هذا الجهاز:**

| الفحص | الأمر | النتيجة |
|---|---|---|
| تثبيت بقفل مجمّد | `pnpm install --frozen-lockfile` | PASS (exit 0) |
| البوابة الكاملة | `pnpm check:all` | PASS (exit 0) |
| تغطية | ضمن `check:all` | 94 ملفًا / 957 اختبارًا — 88.32% statements، 81.74% branches، 86.26% functions، 92.49% lines (العتبة 80/75/80/80 لم تُخفَّض) |
| بناء الويب | ضمن `check:all` | PASS — الحزمة الأساسية 1,071.15 kB (gzip 306.08 kB) |
| متصفح | `pnpm test:e2e` | PASS — 12/12 خلال 25.0s، بمزوّد وهمي داخل الصفحة |
| تدقيق JS | `pnpm audit --json` | PASS — صفر ثغرة (0 info/low/moderate/high/critical)، exit 0 |
| تنسيق Rust | `cargo fmt --check --manifest-path src-tauri/Cargo.toml` | PASS (exit 0) |
| فحص Rust | `cargo check --locked --manifest-path src-tauri/Cargo.toml` | PASS (exit 0) |
| اختبارات Rust | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | PASS — 11 اختبارًا (path_policy + credentials)، صفر فاشل |

### ميزانية الحزمة (الحد 1200 kB)

| الملف | الحجم | gzip |
|---|---|---|
| `dist/assets/index-*.js` (الحزمة الأساسية) | **1,071.15 kB** | 306.08 kB |
| `dist/assets/pdf-*.js` (عند الطلب) | 430.93 kB | 129.04 kB |
| `dist/assets/ort.bundle.min-*.js` (عند الطلب) | 403.16 kB | 109.06 kB |
| `dist/assets/rag-tool-*.js` (عند الطلب) | 105.45 kB | 30.58 kB |
| `dist/assets/rag-embedder-*.js` (عند الطلب) | 101.93 kB | 33.80 kB |
| `dist/assets/index-*.css` | 65.30 kB | 11.40 kB |
| `dist/assets/credentialStore-*.js` | 2.07 kB | 0.98 kB |
| `dist/assets/dist-js-*.js` | 1.87 kB | 0.85 kB |
| `dist/index.html` | 0.73 kB | 0.37 kB |

**ملاحظة صادقة:** الهامش بين الحزمة الأساسية والحدّ 1,200 kB هو الآن **نحو 128.65 kB** (10.7%)
بعد فصل شيفرة RAG (`rag-embedder` و`rag-tool` و`ort.bundle.min` و`pdf`) إلى حزم تُحمَّل عند الطلب.
قبل الفصل كان الهامش ≈ 4.8 kB فقط (0.4%) وكانت أي إضافة صغيرة تكسر الحدّ. الحدّ نفسه **لم يُخفَّض
ولم يُرفع** — التحسّن جاء من تقسيم الشيفرة لا من إضعاف العتبة. لم يُقسَّم بعد ما تبقّى في الحزمة
الأساسية، فأي توسّع جديد ينبغي أن يُقيَّم مقابل الهامش الحالي.

تحذيرات Vite المعروفة بلا أثر: `INEFFECTIVE_DYNAMIC_IMPORT` (استيراد ديناميكي لا ينقل وحدة
لأنها مستوردة ساكنًا في مكان آخر) — تظهر لكل من `src/lib/db/db.ts` و`@tauri-apps/api/core.js`.

## 9. وصف تنفيذ اختبار المتصفح (E2E) — لا مفتاح ولا شبكة

- `playwright.config.ts` يشغّل **بناء الإنتاج** (`vite preview` على `127.0.0.1:4317` بمنفذ
  ثابت `--strictPort`) لا خادم التطوير، ويرفض التشغيل إن لم يكن `dist/index.html` موجودًا.
- `e2e/mock-provider.ts` يثبّت قبل تنفيذ أي كود للتطبيق دالة تعترض `window.fetch` لأصول المزودين
  الأربعة (OpenRouter، Gemini، MiniMax، OpenCode Go) وتعيد بثّ SSE ثابتًا، وتسجّل جسم كل طلب.
  لا مفتاح حقيقي ولا حساب ولا إنفاق: ما في الاختبار سلسلة وهمية قصيرة.
- شبكة أمان ثانية: `page.route("**/*")` يمرّر طلبات `127.0.0.1:4317` فقط، ويسجّل ويُلغي أي
  طلب لعنوان خارجي. اختبار «لا يخرج أي طلب من الجهاز» يقرأ هذا السجل مباشرة.
- 12 سيناريو: عزل المسودة بين جلستين، إيقاف جزئي ينجو من إعادة التحميل، إعادة محاولة بسؤال
  مخصص تاريخي لا بمسودة الحالية، إرسال stateful يحمل السجل، الإعدادات بمفتاح وDialog
  (Escape واستعادة التركيز)، تنقّل بلوحة المفاتيح، 390px بلا تمرير أفقي، حجب موارد Markdown
  البعيدة، عدم عودة جلسة محذوفة، غياب المفتاح من سجل الإعدادات المحفوظ، تدقيق axe، وغياب أي
  طلب خارجي.

## 10. عيوب حقيقية كشفتها بوابة الإصدار (وأُصلحت)

1. **سؤال المستخدم كان يختفي من المحادثة بعد وصول الرد**، وأي إرسال تالٍ في الجلسة نفسها كان
   يذهب **بلا سياق إطلاقًا** رغم أن الوضع stateful. السبب: `onAppended` في `ChatScreen.tsx` كان
   ينشر الصفوف المعتمدة على أنها بطاقات مساعد فقط، فصفّ سؤال المستخدم كان يُكتب في IndexedDB
   ولا يصل إلى المخزن الحي. الإصلاح: نشر صفّ المستخدم أيضًا. **لم تكشفه اختبارات الوحدة**
   لأنها كانت تهيّئ مخزن الحالة بالصفوف مسبقًا.
2. **نصّ إجابة مرئي كان يُمحى عند الإيقاف السريع.** المسار `finalizeCancelled` في
   `chatController.ts` كان يكتب آخر نقطة حفظ (دورة كل 250ms) فينحسر النص المتراكم خلال تلك
   النافذة. الإصلاح: الكتابة من النص المتراكم. ومسار النجاح يكتب المتراكم منذ الأصل.
3. **ثلاثة حقول بلا اسم ميسَّر في شاشة الإعدادات** (قائمة اختيار الموديل، حقل المهلة، حقل
   المجلد) — كشفها axe في متصفح حقيقي. الإصلاح: `aria-label` لكل منها.
4. **`pnpm lint` كان يفشل في HEAD** بخطأ `no-unused-vars` في `startupRecovery.spec.ts`، وكان
   `eslint .` يمرّ على مخرجات `coverage/` المولّدة. الإصلاح: سطر واحد في الاختبار + إضافة
   `coverage` إلى قائمة الاستثناءات في `eslint.config.js`.

## 11. حالة بناء NSIS على هذا الجهاز

نتيجة تنفيذ `pnpm tauri:build:windows` موثّقة في
`.superpowers/sdd/hardening-task-11-report.md` (المهمة 11) و
`.superpowers/sdd/hardening-task-12-report.md` (المهمة 12).
