/**
 * Owner-app i18n (FE-BINDING: "i18n init + namespaces").
 *
 * The platform's i18next instance (`src/i18n/index.ts`) owns the marketing
 * `translation` namespace with English as its fallback. The owner app is
 * German-first (Block I rule 3), so its namespaces are registered here and
 * resolved through `useVoiceT`, which reads the owner app's own locale from
 * the session store — `de` unless the browser or an explicit choice says
 * English — instead of the platform's detected language. A French or
 * Ukrainian browser therefore sees German in the owner app and English on the
 * marketing site, which is what each audience expects.
 *
 * Namespaces are one file per feature: `voice-common`, `voice-nav`, … Add a
 * feature namespace in both languages (`scripts/i18n-check.mjs` fails on
 * missing keys) and list it in VOICE_NAMESPACES.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useSession, type VoiceLocale } from "@/stores/session";

import deAccount from "./locales/de/voice/account.json";
import deAuth from "./locales/de/voice/auth.json";
import deCalls from "./locales/de/voice/calls.json";
import deTools from "./locales/de/voice/tools.json";
import deCommon from "./locales/de/voice/common.json";
import deNav from "./locales/de/voice/nav.json";
import deOverview from "./locales/de/voice/overview.json";
import enAccount from "./locales/en/voice/account.json";
import enAuth from "./locales/en/voice/auth.json";
import enCalls from "./locales/en/voice/calls.json";
import enTools from "./locales/en/voice/tools.json";
import enCommon from "./locales/en/voice/common.json";
import enNav from "./locales/en/voice/nav.json";
import enOverview from "./locales/en/voice/overview.json";

export const VOICE_NAMESPACES = ["voice-common", "voice-nav", "voice-auth", "voice-account", "voice-overview", "voice-calls", "voice-tools"] as const;
export type VoiceNamespace = (typeof VOICE_NAMESPACES)[number];

export const VOICE_RESOURCES: Record<VoiceLocale, Record<VoiceNamespace, Record<string, unknown>>> = {
  de: { "voice-common": deCommon, "voice-nav": deNav, "voice-auth": deAuth, "voice-account": deAccount, "voice-overview": deOverview, "voice-calls": deCalls, "voice-tools": deTools },
  en: { "voice-common": enCommon, "voice-nav": enNav, "voice-auth": enAuth, "voice-account": enAccount, "voice-overview": enOverview, "voice-calls": enCalls, "voice-tools": enTools },
};

for (const [lng, namespaces] of Object.entries(VOICE_RESOURCES)) {
  for (const [ns, resources] of Object.entries(namespaces)) {
    if (!i18n.hasResourceBundle(lng, ns)) i18n.addResourceBundle(lng, ns, resources, true, true);
  }
}

/** The owner app's locale as an Intl tag. */
export function intlLocale(locale: VoiceLocale = useSession.getState().locale): "de-DE" | "en-GB" {
  return locale === "en" ? "en-GB" : "de-DE";
}

/** A `t` bound to the owner app's locale and one namespace. Re-renders on change. */
export function useVoiceT(ns: VoiceNamespace = "voice-common") {
  const { i18n: instance } = useTranslation();
  const locale = useSession((s) => s.locale);
  return useMemo(() => instance.getFixedT(locale, ns), [instance, locale, ns]);
}

/** Non-hook access for toasts, document titles and formatters. */
export function voiceT(ns: VoiceNamespace, key: string, options?: Record<string, unknown>): string {
  return i18n.getFixedT(useSession.getState().locale, ns)(key, options) as string;
}
