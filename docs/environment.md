# سجل بيئة التنفيذ الفعلية — «شورى»

- **التاريخ:** توثيق ختامي عند اكتمال المهام 1-15 (المهمة 15 — التحقق النهائي).
- **النطاق:** بيئة الجهاز التي نُفِّذ عليها MVP فعلًا، بما فيها عيوب بيئة البناء ووصفة إعادة الدخول للبناء.

## 1. الجهاز ونظام التشغيل

- نظام التشغيل: **Windows 10 Pro 25H2** (من السجل: `ProductName` و `DisplayVersion`).
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
| `pnpm test` (vitest run) | **PASS — 87/87 اختبارًا (18 ملفًا)، Duration ~10.1s** |
| `pnpm build` (tsc --noEmit && vite build) | PASS — vite 8.2.2، `dist` مُنتج |

- التحذيرات القديمة المعلومة بلا مساس صحيح: `act(...)` في `ChatScreen.spec.tsx` (موثقة منذ المهمة 13)، وتحذيرا Vite (`configLoader: 'native'`/`__dirname`، وحجم chunk أكبر من 500kB) — لم يزد شيء.
- بلا شبكة في الاختبارات؛ `git status` نظيف قبل كتابة وثائق هذه المهمة.
