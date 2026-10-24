import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

// The two halves of `no-restricted-syntax` are composed here because the rule name is
// single-valued: a later config object that re-declares it would silently drop the
// earlier selectors. Keeping them as named lists makes the exemptions below explicit.
const COLOUR_SELECTORS = [{
  selector: "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
  message: "Raw colour literal. Reference a --sura-* token from src/styles/tokens/ instead.",
}, {
  selector: "Literal[value=/^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\\(/]",
  message: "Raw colour function. Reference a --sura-* token from src/styles/tokens/ instead.",
}, {
  selector: "Literal[value=/^(?:text|bg|border|ring|fill|stroke|outline|divide|from|to|via)-(?:white|black)$/]",
  message: "Hardcoded colour utility. The design system has no white/black token — use a --sura-* surface or text token so both themes stay correct.",
}];

// Font sizes come from --sura-text-* tokens. Tailwind reads an untyped arbitrary value
// such as `text-[var(--x)]` as a colour, so a size token must carry the `length:` hint,
// and a raw pixel size bypasses the scale altogether.
const RAW_SIZE = "(?:^|\\s)text-\\[\\d+(?:\\.\\d+)?(?:px|rem|em)\\]";
const UNTYPED_SIZE = "text-\\[var\\(--sura-text-(?:display|h[1-4]|body|body-sm|caption|label|mini|micro)\\)\\]";
const RAW_SIZE_MESSAGE = "Raw font size. Use text-[length:var(--sura-text-*)] from src/styles/tokens/typography.css.";
const UNTYPED_SIZE_MESSAGE =
  "Untyped size token: Tailwind compiles text-[var(--sura-text-...)] to `color`. Write text-[length:var(--sura-text-...)].";
const TYPOGRAPHY_SELECTORS = [
  { selector: `Literal[value=/${RAW_SIZE}/]`, message: RAW_SIZE_MESSAGE },
  { selector: `TemplateElement[value.raw=/${RAW_SIZE}/]`, message: RAW_SIZE_MESSAGE },
  { selector: `Literal[value=/${UNTYPED_SIZE}/]`, message: UNTYPED_SIZE_MESSAGE },
  { selector: `TemplateElement[value.raw=/${UNTYPED_SIZE}/]`, message: UNTYPED_SIZE_MESSAGE },
];

// [T3.2/D5] The Arabic block ranges (Arabic, Arabic Supplement, Arabic Extended-A,
// Arabic Presentation Forms-A/B). Comments are never AST nodes, so an Arabic comment is
// untouched by design; only literals, template text and JSX text are checked.
const ARABIC = "[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]";
const ARABIC_MESSAGE =
  "Hardcoded Arabic text. User-visible text lives in src/i18n/en.ts (source of truth) and its locale peers and is read through UiText - t()/plural()/format*. A value that is stored or archived data rather than display text must be added to the documented exemption list in eslint.config.js.";
const ARABIC_SELECTORS = [{
  selector: `Literal[value=/${ARABIC}/]`,
  message: ARABIC_MESSAGE,
}, {
  selector: `TemplateElement[value.raw=/${ARABIC}/]`,
  message: ARABIC_MESSAGE,
}, {
  selector: `JSXText[value=/${ARABIC}/]`,
  message: ARABIC_MESSAGE,
}];

export default tseslint.config(
  // Generated output is not project source: linting it would make the gate depend on
  // whether a previous coverage or E2E run happened to leave artifacts on disk.
  { ignores: ["dist", "coverage", "playwright-report", "test-results", "src-tauri/target", ".superpowers"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Library-typed callbacks (e.g. the Tauri IPC mocks in e2e/fixtures.ts) must declare
      // a parameter they cannot use; a leading underscore states that intent.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Design tokens are the only owner of visual values (CLAUDE.md: "never hardcode a
    // style"). The codebase currently has zero violations of these three, so they are
    // regression guards: they cost nothing today and stop a raw colour from being
    // inlined into a component tomorrow. Named colours ("red", "currentColor") are
    // deliberately not banned — only literal values and the white/black utilities,
    // which have no counterpart in the token set and would break dark mode.
    //
    // [T3.2/D5] The Arabic selectors are the text half of the same rule: one variable,
    // one owner. See the exemption object below for the deliberate exceptions.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...COLOUR_SELECTORS, ...TYPOGRAPHY_SELECTORS, ...ARABIC_SELECTORS],
    },
  },
  {
    // [T3.2/D5] Deliberate exemptions from the Arabic rule - each one is a fact about
    // the file, not a convenience:
    //  - `src/i18n/**` is the owner of the text, so it must contain it.
    //  - `**/*.spec.*` and `src/test/**` assert on user-visible text and build fixtures;
    //    an assertion must quote the literal or it would test nothing.
    //  - The per-file list below is the measured residue of T3.2c: 83 Arabic literals in
    //    16 files, each one a model prompt (Class 1), byte-stable stored data (Class 2),
    //    the Markdown archive/export (Class 3), or an internal diagnostic/guard (Class 5).
    //    Every Class-4 site - a thrown error, toast or notice the user reads - is now a
    //    resource key translated at its boundary, so `src/features/**` and every other
    //    non-UI file is guarded again. The list may only shrink; adding a file needs a
    //    recorded reason and one of those classes. [T7.6/Q8] the last Class-4
    //    candidates - the recovery-report details in `parser.ts` (a failed quarantine
    //    move and usage restored with no provider snapshot) - are now resource keys;
    //    `parser.ts` stays listed for its thrown, redacted validation messages (Class 5).
    //    The two credential modules have since left the list: their errors are keys too.
    // The colour and typography guards stay active in every exempted file.
    files: [
      "src/i18n/**",
      "src/**/*.spec.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
      "src/test/**",
      // Class 1 - model prompts: translating them changes what the model is told.
      "src/lib/chat/synthesis.ts",
      "src/lib/chat/turnBuilder.ts",
      "src/lib/providers/keyTest.ts",
      // Class 2 - stored bytes that stay byte-stable; the D6 render-map reads them.
      "src/lib/chat/messageError.ts",
      "src/lib/db/repos/attempts.ts",
      // Class 3 - the Markdown archive/export, i.e. written prose (T3.3/T3.4).
      "src/lib/export/sessionExporter.ts",
      "src/lib/markdown/writer.ts",
      // Class 5 - internal diagnostics: abort reasons, validation and path guards.
      "src/lib/chat/chatController.ts",
      "src/lib/chat/operationCoordinator.ts",
      "src/lib/db/repos/usage.ts",
      "src/lib/markdown/archivePaths.ts",
      "src/lib/markdown/parser.ts",
      "src/lib/markdown/sink.ts",
      "src/lib/markdown/tauriSink.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...COLOUR_SELECTORS, ...TYPOGRAPHY_SELECTORS],
    },
  },
);
