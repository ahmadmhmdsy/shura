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
- **المنصّات المدعومة (T6.4 Step 2):** المشحون لهذا الإصدار هو **Windows 10/11 x64** (مثبّت NSIS) فقط. **Linux** يبقى فحص ترجمة في CI (`cargo fmt/check/test` على `ubuntu-latest` مع حزم WebKitGTK) بلا حزمة وبلا دعم، و**macOS** لم يُبنَ أصلًا. التفصيل والأدلة في `docs/release-checklist.md` القسم 2.

## 8.1. السلسلة الرباعية النهائية (المهمة 15)

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` → **CHAIN_ALL_PASS (exit 0)**

| الأمر | النتيجة |
|---|---|
| `pnpm typecheck` (tsc --noEmit) | PASS |
| `pnpm lint` (eslint .) | PASS |
| `pnpm test` (vitest run) | **PASS** — الأعداد المقيسة حاليًا في `8.2 أدناه؛ هذا صف تاريخي من المهمة 15 كان يسجّل 87/87 اختبارًا عبر 18 ملفًا |
| `pnpm build` (tsc --noEmit && vite build) | PASS — vite 8.2.2، `dist` مُنتج |

- التحذيرات القديمة المعلومة بلا مساس صحيح: `act(...)` في `ChatScreen.spec.tsx` (موثقة منذ المهمة 13)، وتحذيرا Vite (`configLoader: 'native'`/`__dirname`، وحجم chunk أكبر من 500kB) — لم يزد شيء.
- بلا شبكة في الاختبارات؛ `git status` نظيف قبل كتابة وثائق هذه المهمة.

## 8.2. بوابة الإصدار (المهمة 11) — ما هي وما نتيجتها

أوامر البوابة المضافة في `package.json`:

| الأمر | ما يفعله |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` ثم `tsc --noEmit -p tsconfig.node.json` (المشروع الثاني يشمل `vite.config.ts` و`playwright.config.ts` و`eslint.config.js` و`e2e/**`) |
| `pnpm lint` | `eslint .` على الشيفرة فقط (dist و coverage و test-results و playwright-report و src-tauri/target و .superpowers مستثناة) |
| `pnpm test:coverage` | Vitest + تغطية v8 بعتبة 80/75/80/80 |
| `pnpm build` | فحص الأنواع ثم `vite build` |
| `pnpm check:all` | typecheck + lint + coverage + build + check:bundle + audit:check |
| `pnpm test:e2e` | Playwright (Chromium) على بناء الإنتاج عبر منفذ preview ثابت 4317 |
| `pnpm test:e2e:desktop` | سطح المكتب: يشغّل التطبيق الحقيقي بمنفذ CDP ثم `playwright test --project=tauri` (6 اختبارات) |
| `pnpm test:e2e:live` | التحقق الحي مع مزوّد حقيقي (اختياري وخارج CI): يفعّل `SHURA_LIVE_E2E=1` ويحمّل `.env` ثم يشغّل مشروع `live` على `http://tauri.localhost/`. بلا مفتاح يُتخطّى الاختبار (SKIPPED) ولا يفشل. |
| `pnpm check:live-secrets` | يفحص `test-results/` و`playwright-report/` بحثًا عن أي قيمة سرّية من البيئة، وينشر أسماء الملفات فقط لا القيم. |
| `pnpm test:e2e:tauri` | مشروع سطح المكتب وحده؛ يحتاج تطبيقًا قيد التشغيل بمنفذ CDP مفتوحًا (السكربت أعلاه يتولّاه) |
| `pnpm tauri:build:windows` | `pnpm tauri build --bundles nsis` |

**أدوات البوابة المثبتة:** `@playwright/test` 1.63.0، `@axe-core/playwright` 4.13.0،
`@vitest/coverage-v8` 5.0.1، `@types/node` 26.6.2. متصفح Chromium (playwright v1243 /
Chrome for Testing 153.0.8010.12) كان موجودًا في `%LOCALAPPDATA%\ms-playwright` فلم يحتج تحميلًا جديدًا.

**نتائج مقيسة فعلًا على هذا الجهاز:**

| الفحص | الأمر | النتيجة |
|---|---|---|
| تثبيت بقفل مجمّد | `pnpm install --frozen-lockfile` | PASS (exit 0) |
| البوابة الكاملة | `pnpm check:all` | PASS (exit 0) |
| تغطية | ضمن `check:all` | <!--G:counts.files-->109<!--/G--> ملفًا / <!--G:counts.tests-->1171<!--/G--> اختبارًا — <!--G:cov.statements-->88.63<!--/G-->% statements، <!--G:cov.branches-->82.35<!--/G-->% branches، <!--G:cov.functions-->86.29<!--/G-->% functions، <!--G:cov.lines-->92.49<!--/G-->% lines (العتبة 80/75/80/80 لم تُخفَّض) |
| بناء الويب | ضمن `check:all` | PASS — الحزمة الأساسية <!--G:bundle.entry.kb-->1,112.92<!--/G--> kB (gzip <!--G:bundle.entry.gzip-->313.88<!--/G--> kB)، تحت سقف 1,200,000 بايت؛ البوابة `scripts/check-bundle.mjs` |
| متصفح | `pnpm build && pnpm test:e2e:browser` | PASS — 24 ناجح / 0 فاشل (ومشروع tauri يضيف 6 اختبارات ويحتاج نافذة سطح مكتب حيّة) (القسم 12 يوثّق ما أُصلح) |
| تدقيق JS (خام) | `pnpm audit --json` | FAIL (exit 1) — 11 تنبيهًا: 1 critical، 5 high، 5 moderate؛ ثلاثة منها بلا إصلاح منشور. الادعاء السابق «صفر ثغرة» كان قديمًا وغير صحيح. |
| بوابة التدقيق | `pnpm audit:check` | PASS — كل تنبيه مسجَّل في `docs/security/dependency-advisories.md` مع مبرر وتاريخ إعادة مراجعة، ولا يوجد تنبيه غير مسجَّل أو منتهي المراجعة. |
| تنسيق Rust | `cargo fmt --check --manifest-path src-tauri/Cargo.toml` | PASS (exit 0) |
| فحص Rust | `cargo check --locked --manifest-path src-tauri/Cargo.toml` | PASS (exit 0) |
| اختبارات Rust | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | PASS — 11 اختبارًا (path_policy + credentials)، صفر فاشل |

### ميزانية الحزمة (الحد 1200 kB)

| الملف | الحجم | gzip |
|---|---|---|
| `dist/assets/index-*.js` (الحزمة الأساسية) | **<!--G:bundle.entry.kb-->1,112.92<!--/G--> kB** | <!--G:bundle.entry.gzip-->313.88<!--/G--> kB |
| `dist/assets/pdf-*.js` (عند الطلب) | <!--G:bundle.pdf.kb-->430.23<!--/G--> kB | <!--G:bundle.pdf.gzip-->127.42<!--/G--> kB |
| `dist/assets/ort.wasm.bundle.min-*.js` (عند الطلب) | <!--G:bundle.ort.kb-->70.67<!--/G--> kB | <!--G:bundle.ort.gzip-->23.24<!--/G--> kB |
| `dist/assets/rag-tool-*.js` (عند الطلب) | <!--G:bundle.ragTool.kb-->107.85<!--/G--> kB | <!--G:bundle.ragTool.gzip-->31.14<!--/G--> kB |
| `dist/assets/rag-vector-index-*.js` (مُحمَّل مسبقًا) | <!--G:bundle.ragVectorIndex.kb-->1.93<!--/G--> kB | <!--G:bundle.ragVectorIndex.gzip-->0.77<!--/G--> kB |
| `dist/assets/hnswlib-wasm-*.js` (مُحمَّل مسبقًا) | <!--G:bundle.hnswlib.kb-->0.14<!--/G--> kB | <!--G:bundle.hnswlib.gzip-->0.14<!--/G--> kB |
| `dist/assets/rag-embedder-*.js` (عند الطلب) | <!--G:bundle.ragEmbedder.kb-->107.48<!--/G--> kB | <!--G:bundle.ragEmbedder.gzip-->35.21<!--/G--> kB |
| `dist/assets/tokenizers-*.js` (عند الطلب) | <!--G:bundle.tokenizers.kb-->34.58<!--/G--> kB | <!--G:bundle.tokenizers.gzip-->10.61<!--/G--> kB |
| `dist/assets/ort-wasm-simd-threaded-*.wasm` (عند الطلب) | <!--G:bundle.ortWasm.kb-->14,239.90<!--/G--> kB | <!--G:bundle.ortWasm.gzip-->3,687.16<!--/G--> kB |
| `dist/assets/ort-wasm-simd-threaded-*.mjs` (عند الطلب) | <!--G:bundle.ortGlue.kb-->24.38<!--/G--> kB | <!--G:bundle.ortGlue.gzip-->9.12<!--/G--> kB |
| `dist/assets/pdf.worker.min-*.mjs` (عند الطلب) | <!--G:bundle.pdfWorker.kb-->1,265.41<!--/G--> kB | <!--G:bundle.pdfWorker.gzip-->375.25<!--/G--> kB |
| `dist/assets/index-*.css` | <!--G:bundle.css.kb-->94.19<!--/G--> kB | <!--G:bundle.css.gzip-->23.20<!--/G--> kB |
| `dist/assets/credentialStore-*.js` | <!--G:bundle.credentialStore.kb-->2.01<!--/G--> kB | <!--G:bundle.credentialStore.gzip-->0.91<!--/G--> kB |
| `dist/assets/dist-js-*.js` | <!--G:bundle.distJs.kb-->1.86<!--/G--> kB | <!--G:bundle.distJs.gzip-->0.85<!--/G--> kB |
| `dist/index.html` | <!--G:bundle.html.kb-->0.92<!--/G--> kB | <!--G:bundle.html.gzip-->0.48<!--/G--> kB |

الأصول الثلاثة الأخيرة (wasm المحرّك ولاصقه وعامل pdf.js) **تُشحن داخل المثبّت** وتُقرأ من القرص
عند أول استخدام لـRAG؛ لا تُنزَّل من شبكة، وعمود gzip مذكور للمقارنة مع النسخ المضغوطة لا للنقل.

**ملاحظة صادقة:** الهامش بين الحزمة الأساسية والحدّ 1,200,000 بايت هو **نحو <!--G:bundle.headroom.kb-->87.08<!--/G--> kB (<!--G:bundle.headroom.percent-->7.3<!--/G-->%)**.
قبل فصل شيفرة RAG كان ≈ 4.8 kB فقط (0.4%) وكانت أي إضافة صغيرة تكسر الحدّ. الحدّ نفسه **لم يُخفَّض
ولم يُرفع** — التحسّن جاء من تقسيم الشيفرة لا من إضعاف العتبة. لكن `modulepreload` في `dist/index.html`
يجعل الحمولة الفعلية عند الإقلاع **<!--G:bundle.eager.kb-->1,331.49<!--/G--> kB** لأن قطع RAG تُحمَّل مسبقًا.
نُفِّذ T1.3 Step 9 (استيرادات ديناميكية في `dispatch.ts` و`RagSettings.tsx` و`documentManager.ts`) **ولم
تنقص** الحمولة الفعلية: قائمة `modulepreload` تُشتق من استيرادات المدخل الساكنة، وRolldown يُصدر قطع
`codeSplitting.groups` كاستيرادات ساكنة للمدخل. إزالة التجميع تُلغي التحميل المسبق لكنها تنقل شيفرة RAG
إلى الحزمة الأساسية فتصبح 1,304,578 بايت، أي فوق الحدّ. لذلك بقي الحدّ على الحزمة الأساسية (D7/Q7) وبقيت
الحمولة الفعلية معلومةً لا بوابة؛ التفاصيل والقياسات في `docs/adr/0004-desktop-asset-and-csp-policy.md`.
فأي توسّع جديد ينبغي أن يُقيَّم مقابل الهامش الأساسي **ومقابل هذه الفجوة**.

**اصطلاح gzip:** الأرقام هنا مقيسة بـ`node zlib` المستوى 9 داخل `scripts/render-env-tables.mjs`.
قد يختلف رقم gzip الذي يطبعه `vite build` بنحو 1% لأنه يأتي من الحزّام نفسه؛ عمود البايت الخام
متطابق في الحالتين، وهو ما تقيسه البوابة.

**أثر طبقة التوطين على الميزانية:** كبرت الحزمة الأساسية من 1,071.15 kB إلى **1,095.92 kB** (عند قياس طبقة التوطين وقتها؛ والرقم الحالي 1,108.37 kB كما في القسم 8.2 وREADME)
(+24.77 kB)، لأن كتالوجَي اللغة (`src/i18n/en.ts` و`ar.ts`) مستوردان ساكنًا
في الحزمة الأساسية. الهامش لا يزال كافيًا، لكن أي لغة ثالثة ستضيف كلفة مماثلة إلى الحزمة الأساسية
ما لم تُحمَّل الكتالوجات عند الطلب لاحقًا. هذا قيد مسجّل لا عيب مُصلَح.

تحذيرات Vite المعروفة بلا أثر: `INEFFECTIVE_DYNAMIC_IMPORT` (استيراد ديناميكي لا ينقل وحدة
لأنها مستوردة ساكنًا في مكان آخر) — تظهر لكل من `src/lib/db/db.ts` و`@tauri-apps/api/core.js`.

## 9. وصف تنفيذ اختبار المتصفح (E2E) — لا مفتاح ولا شبكة

- `playwright.config.ts` يشغّل **بناء الإنتاج** (`vite preview` على `127.0.0.1:4317` بمنفذ
  ثابت `--strictPort`) لا خادم التطوير، ويرفض التشغيل إن لم يكن `dist/index.html` موجودًا.
- **`pnpm test:e2e:browser` لا يبني شيئًا.** يشغّل `playwright test --project=browser` فقط،
  فيختبر ما في `dist/` كما هو. ملف قديم ⇒ نتائج كاذبة (نجاحًا كانت أو فشلًا) بلا أي إشارة.
  الأمر الآمن دائمًا: `pnpm build && pnpm test:e2e:browser`. الحماية القائمة تكتفي بوجود
  `dist/index.html` ولا تكشف قِدَمه.
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

### 9.1 اختبار سطح المكتب (WebView2) — 2026-10-12

- **الوضع الوحيد الممكن على Windows في `@srsholmes/tauri-playwright@0.4.1` هو `cdp`:** الوضع
  `tauri` ينتظر ملف مقبس يونكس (`/tmp/tauri-playwright.sock`) لا ينشئه ملحق Windows، وفرع
  `tauriCommand` يقرأ منفذ TCP من مخرجات التطبيق ثم **يتجاهله** ويبني `PluginClient(socketPath)`
  دائمًا (dist/index.js:1703-1708).
- الأمر: `pnpm test:e2e:desktop` (السكربت `scripts/e2e-desktop.mjs`) — يحدّد `app.exe`
  الأحدث بناءً (`TAURI_E2E_APP` يتجاوزه)، لأن اختبارات CSP تقرأ أسماء الأصول المُجزّأة من
  `dist/assets` وتطلبها من التطبيق، فبناء قديم يعطي 404. يشغّله بـ `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
  `--remote-debugging-port=9222`، ينتظر `GET /json/version`، ينفّذ `playwright test --project=tauri`
  ثم يوقف التطبيق الذي شغّله. متغيّرات التجاوز: `TAURI_E2E_APP` و`TAURI_E2E_CDP`.
- **التحقق الحي (T6.7):** `scripts/e2e-live.mjs` يمرّر `TAURI_E2E_PROJECT=live` إلى `scripts/e2e-desktop.mjs` (الافتراضي `tauri`) ويفعّل `SHURA_LIVE_E2E`، فلا يُجمع مشروع `live` إطلاقًا في تشغيل عادي أو في CI. مفتاح OpenCode Go يُقرأ من `OPENCODE_API_KEY` في `.env` (غير متتبّع، ولا يُطبع أو يُسجَّل) أو من `SHURA_LIVE_OPENCODE_KEY`، وبقية المزوّدين من `SHURA_LIVE_<PROVIDER>_KEY`. `SHURA_LIVE_NO_DOTENV=1` يثبت البوابة بلا مفتاح.
- `e2e/tauri-app.spec.ts` ينقل نافذة التطبيق بنفسه إلى أصل المعاينة (`devUrl` مُهمَل في `cdp`)،
  وهذا يعزل كتاباته عن ملف التطبيق الشخصي، وينتظر `main` لا `window.__PW_ACTIVE__` (الذي لا
  يعرّفه إلا وضع المقبس). **حدود مقيسة:** لا تُركَّب اعتراضات IPC في `cdp`، فتصل الاختبارات إلى
  مخزن المفاتيح الحقيقي **قراءةً فقط**، وملف WebView2 يبقى دائمًا على جهاز المطوّر (CI يبدأ فارغًا).
- نتيجة T6.1 في 2026-10-12 (قبل إضافة اختبار T6.2 أدناه): **4 ناجح / 0 فاشل (13.8 ث)** بلا عملية تطبيق متبقّية.
- أُضيف 2026-10-12 (T6.2) `e2e/tauri-csp.spec.ts` على **أصل التطبيق نفسه** (`http://tauri.localhost`)،
  حيث يُفرض CSP الإنتاج فعلًا: `WebAssembly` يشغّل وحدة صغيرة، وwasm محرّك ORT المحزوم (13.58 م.ب) يُصرَّف
  ويُخدَم 200 من أصل التطبيق بصفر حدث `securitypolicyviolation`، وقطعة ORT المحزومة تُهيَّأ
  (`InferenceSession`/`env`) وتصل إلى إنشاء جلسة ثم ترفض بايتات غير صحيحة **بعد** تحميل wasm الخاص بها.
- **إثبات الأسنان في الاتجاهين:** إرجاع `script-src` إلى قيمة ما قبل T1.3 (`'self'` وحدها) وإعادة البناء
  أعطى **2 فاشل / 4 ناجح (exit 1)** بنصّ العَرَض الإنتاجي نفسه (`no available backend found ... Content
  Security Policy ... 'unsafe-eval' is not an allowed source`)، ثم إعادة `'wasm-unsafe-eval'` وإعادة
  البناء أعطت **6 ناجح / 0 فاشل (18.7 ث)**.
- **حدّ مقيس:** لا ينزّل الاختبار نموذج التضمين (130 م.ب لـ`multilingual-e5-small`) ولا ينفّذ استدلالًا؛
  ذلك يحتاج الشبكة و`plugin-http`، فمكانه اختبار حيّ اختياري — قرار للمستخدم.

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

### 11.1 قرار الحزمة المشحونة: NSIS وحده (T6.3 — 2026-10-12)

- **القرار:** الحزمة المشحونة الوحيدة لهذا الإصدار هي **NSIS**:
  `src-tauri/target/release/bundle/nsis/shura_0.1.0_x64-setup.exe` (4,095,495 بايت، **غير موقّعة** بحسب Q4)،
  ويُنتجها `pnpm tauri:build:windows` (= `pnpm tauri build --bundles nsis`). **لا يُشحن `.msi` في هذا الإصدار.**
- **السبب وقائع لا تفضيل:** هدف WiX 3 يحتاج `light.exe`، وهو يتطلب **.NET Framework 3.5** غير المثبّت على هذا
  الجهاز؛ تشغيل الهدف الافتراضي `all` يفشل عند MSI فيبقى `bundle/msi` فارغًا (مقيس: 0 ملفًا). والقيمة المعتادة
  لـ`.msi` (نشر مؤسسي عبر Group Policy) غير قائمة أصلًا ما دام المثبّت غير موقّع (Q4).
- **إن أراد المشرف لاحقًا إضافة `.msi`:** ثبّت .NET Framework 3.5 (أو WiX 4 الذي لا يحتاجه) ثم شغّل
  `pnpm tauri build --bundles nsis,msi`؛ لا تغيير في شيفرة التطبيق مطلوب لأن اختيار الهدف من سطر الأوامر.
  ويُضاف الصف في `docs/release-checklist.md` عند نجاحه.
- **حدّ صادق:** لم يُثبَّت المثبّت ولم يُشغَّل على جهاز مستخدم في هذه المرحلة (بوابتان بشريتان: T5.3 Step 2 وT6.5 Step 3).

- **حالة التوقيع (T6.5 Step 3):** ملف المثبّت **غير موقّع** — `Get-AuthenticodeSignature` يعيد `Status: NotSigned`، ولا يوجد أي إعداد توقيع في `tauri.conf.json` ولا سرّ توقيع في CI. ما يراه المستخدم عبر SmartScreen والعواقب المقبولة ومسار التوقيع لاحقًا موثّقة في `docs/release-checklist.md` القسم 3.

## 12. بوابة التوطين والرموز التصميمية (2026-10-05)

أُضيفت طبقة توطين موحّدة (`src/i18n/`) ومساعد نص `UiText`، وحُوّلت نصوص الواجهة إليها،
وأصبحت اللغة والاتجاه يُضبطان على `<html>` قبل أول رسم. القياس الفعلي بعد التحويل:

| الفحص | الأمر | النتيجة |
|---|---|---|
| فحص الأنواع | `pnpm typecheck` | PASS (exit 0) |
| التدقيق | `pnpm lint` | PASS — صفر خطأ وصفر تحذير |
| الاختبارات والتغطية | `pnpm test:coverage` | PASS — 97 ملفًا / 1005 اختبارًا (قياس 2026-10-05؛ الحالة الحالية في القسم 8.2: 109 ملفًا / 1162 اختبارًا) |
| البناء | `pnpm build` | PASS |
