import { useVoiceT } from "@/i18n/voice";
import type { Tier } from "@/pages/telephony/_lib/toolMeta";

const CLS: Record<Tier, string> = {
  R: "border-[var(--line)] text-[var(--text-2)]",
  W: "border-[var(--brand)] text-[var(--brand)]",
  X: "border-[var(--line)] bg-[var(--sand)] text-[var(--text-3)]",
};

/** Tier in owner words: Nur lesen · Schreiben · Nicht am Telefon (FE7 §1). */
export default function TierChip({ tier }: { tier: Tier }) {
  const t = useVoiceT("voice-tools");
  return (
    <span title={t(`tierHint.${tier}`)} data-tier={tier} className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${CLS[tier]}`}>
      {t(`tier.${tier}`)}
    </span>
  );
}
