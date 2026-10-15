/**
 * Kept deliberately, with one badge left on the page (live listen-in).
 *
 * S16 took sentiment and talk ratio off this list; what remains needs call
 * audio in a browser, and there is no endpoint or media proxy that can supply
 * it. The component stays regardless of the count: the next surface that ships
 * ahead of its backend needs it, and the inventory test
 * (src/test/voice/mockInventory.test.ts) is what keeps the count honest.
 */
/**
 * De-mock task contract: anything the backend cannot serve yet stays visible
 * but is *unmistakably* labelled as mock, with the reason and (where known)
 * the follow-up that will replace it. Three pieces:
 *
 *   <MockedBadge />        – the amber pill itself
 *   <MockedSection />      – a card for an in-page section that is still mock
 *   <MockedRouteBanner />  – a full-width strip on top of a whole mocked view
 *
 * The two container variants carry `data-mock="true"` on their root element so
 * the inventory is countable — from the DOM in a test, and from the source with
 * a grep. `src/test/voice/mockInventory.test.ts` pins the exact count for the
 * Voice page, so de-mocking something is a deliberate edit to that number
 * rather than a badge that quietly disappears.
 */
import { ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';

export function MockedBadge({ label, title }: { label?: string; title?: string } = {}) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
    >
      <FlaskConical className="h-3 w-3" aria-hidden="true" />
      {label ?? 'Mocked'}
    </span>
  );
}

export function MockedSection({
  title,
  reason,
  children,
}: {
  title: string;
  reason: string;
  children: ReactNode;
}) {
  return (
    <section data-mock="true" className="rounded-xl border border-dashed border-amber-300/70 bg-amber-50/40 p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-medium text-[var(--ink)]">{title}</h3>
        <MockedBadge />
      </div>
      <p className="mb-3 text-xs text-amber-800/80">{reason}</p>
      <div className="opacity-60">{children}</div>
    </section>
  );
}

/** Sits above an entire view that still renders demo data. */
export function MockedRouteBanner({ reason, intro }: { reason: string; intro?: string }) {
  return (
    <div data-mock="true" className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2.5">
      <MockedBadge />
      <p className="text-xs leading-relaxed text-amber-800">
        {intro ?? 'Everything below is demo data — this section is not wired to the backend yet.'} {reason}
      </p>
    </div>
  );
}
