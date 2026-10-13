import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import i18next from "eslint-plugin-i18next";
import tseslint from "typescript-eslint";

/**
 * Files the Block I owner app owns (FE0). Every JSX string in them must come
 * from i18n (`useVoiceT`) — the `no-literal-string` rule below fails the
 * build otherwise. Legacy voice views are migrated sprint by sprint
 * (FE2 calls, FE3 settings, …) and join this list as they land.
 */
const OWNER_APP_FILES = [
  "src/components/account/**/*.tsx",
  "src/pages/telephony/_components/owner/**/*.tsx",
  "src/pages/telephony/_components/shared/VoiceAuthGuard.tsx",
  "src/pages/telephony/_components/shared/ViewErrorBoundary.tsx",
  "src/pages/telephony/_components/sidebar/**/*.tsx",
  "src/pages/telephony/_components/shared/StatusBanner.tsx",
  "src/pages/telephony/_components/overview/**/*.tsx",
  "src/pages/telephony/_components/owner-calls/**/*.tsx",
  "src/pages/telephony/_components/settings/profile/**/*.tsx",
  "src/pages/telephony/_components/settings/telephony/**/*.tsx",
  "src/pages/telephony/_components/setup/**/*.tsx",
  "src/pages/telephony/_components/knowledge/**/*.tsx",
  "src/pages/telephony/_components/rules/**/*.tsx",
  "src/pages/telephony/_components/privacy/**/*.tsx",
  "src/pages/telephony/_components/trust/**/*.tsx",
  "src/pages/telephony/_components/settings/tools/**/*.tsx",
  "src/pages/telephony/_components/followups/**/*.tsx",
  "src/pages/telephony/_components/integrations/**/*.tsx",
  "src/pages/telephony/_components/reports/**/*.tsx",
  "src/pages/telephony/_components/attention/**/*.tsx",
  "src/pages/telephony/_components/campaigns/**/*.tsx",
  "src/pages/telephony/_components/settings/team/**/*.tsx",
  "src/pages/telephony/_components/settings/templates/**/*.tsx",
  "src/pages/telephony/_components/settings/widget/**/*.tsx",
  "src/pages/telephony/_components/whatsnew/**/*.tsx",
  "src/pages/telephony/_components/shared/InfoTag.tsx",
  "src/pages/telephony/_components/shared/NotYetView.tsx",
  "src/pages/telephony/_components/shared/ViewSkeleton.tsx",
  "src/pages/telephony/OwnerLoginPage.tsx",
  "src/components/voice/MaskedNumber.tsx",
  "src/components/ui/empty-state.tsx",
  "src/components/ui/data-table.tsx",
];

export default tseslint.config(
  { ignores: ["dist", "playwright-report", "test-results", "src/lib/api/generated/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Configuration is read at runtime from `window.__ENV__`; anything taken
    // from `import.meta.env` would be baked into the bundle at build time.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Any `import.meta.env` that is not directly `.DEV`, `.PROD` or
          // `.MODE` — so destructuring it or aliasing it is caught as well.
          selector:
            "MemberExpression[object.type='MetaProperty'][property.name='env']:not(MemberExpression[computed=false][property.name=/^(DEV|PROD|MODE)$/] > .object)",
          message:
            "Read configuration with env() from src/lib/env.ts: import.meta.env is inlined at build time. Only DEV, PROD and MODE may be read from it.",
        },
      ],
    },
  },
  {
    files: OWNER_APP_FILES,
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          // Translation callees: anything they are called with is a key, not copy.
          callees: { exclude: ["^t$", "^t[a-z]$", "^tn$", "^voiceT$", "i18n\\.", "getFixedT", "labels\\.", "formatCurrency", "register$", "setValue$", "watch$", "setError$", "trigger$", "^card$", "replace$", "disclosureFor", "getElementById"] },
          "jsx-attributes": {
            include: ["aria-label", "title", "placeholder", "alt", "aria-description"],
          },
          "jsx-components": { exclude: ["pre", "code"] },
          words: { exclude: ["3days.ai", "\\d+", "[•·–—…]+", "%", "€"] },
        },
      ],
    },
  }
);
