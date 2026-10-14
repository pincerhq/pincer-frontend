/**
 * The app's dropdown. A native `<select>` takes our styling closed, but its
 * open list is drawn by the OS and no stylesheet reaches it, so this renders
 * the options as ordinary DOM instead.
 *
 * It takes `<option>` / `<optgroup>` children like the element it replaces,
 * which keeps each swap a one-word edit and the option lists where the data is.
 */
import { Children, isValidElement, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Radix reserves `""` for "cleared", and the turn-model picker uses it for
 * "server default". The sentinel keeps that meaning inside this file.
 */
const EMPTY = '__plat_empty__';
const toRadix = (v: string) => (v === '' ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? '' : v);

const TRIGGER_VARIANTS = {
  /** Form field — the modal's inputs. */
  field:
    'h-10 w-full rounded-[10px] border border-[var(--line)] bg-[var(--sand)] px-3 text-sm text-[var(--ink)] hover:border-[var(--text-5)]',
  /** Filter pill — the history toolbar. */
  pill:
    'h-8 rounded-full border border-[var(--line)] bg-[var(--paper)] pl-3 pr-2 text-[11px] font-medium text-[var(--text-3)] hover:text-[var(--ink)]',
  /** Inline, chromeless — sits inside another control's border. */
  bare: 'bg-transparent text-[10px] text-[var(--text-2)] max-w-[190px]',
} as const;

function Item({
  value,
  disabled,
  children,
}: {
  value: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <SelectPrimitive.Item
      value={value}
      disabled={disabled}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-[8px] py-1.5 pl-2.5 pr-7 text-[13px] text-[var(--text-2)] outline-none',
        'data-[highlighted]:bg-[var(--sand)] data-[highlighted]:text-[var(--ink)]',
        'data-[state=checked]:font-semibold data-[state=checked]:text-[var(--ink)]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="h-3.5 w-3.5" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/** `<option>` / `<optgroup>` children as Radix items. */
function renderOptions(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return null;

    if (child.type === 'optgroup') {
      const props = child.props as { label?: string; children?: ReactNode };
      return (
        <SelectPrimitive.Group>
          <SelectPrimitive.Label className="px-2.5 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--text-5)]">
            {props.label}
          </SelectPrimitive.Label>
          {renderOptions(props.children)}
        </SelectPrimitive.Group>
      );
    }

    if (child.type === 'option') {
      const props = child.props as {
        value?: string | number;
        disabled?: boolean;
        children?: ReactNode;
      };
      return (
        <Item value={toRadix(String(props.value ?? ''))} disabled={props.disabled}>
          {props.children}
        </Item>
      );
    }

    return null;
  });
}

export default function PlatSelect({
  value,
  onChange,
  children,
  ariaLabel,
  id,
  variant = 'field',
  className,
  disabled,
  placeholder,
}: {
  value: string | number;
  onChange: (value: string) => void;
  /** `<option>` and `<optgroup>` elements, as for a native select. */
  children: ReactNode;
  ariaLabel?: string;
  id?: string;
  variant?: keyof typeof TRIGGER_VARIANTS;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <SelectPrimitive.Root
      value={toRadix(String(value))}
      onValueChange={(v) => onChange(fromRadix(v))}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'flex cursor-pointer items-center justify-between gap-1.5 outline-none transition-colors',
          'focus-visible:border-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50',
          'data-[state=open]:border-[var(--ink)]',
          TRIGGER_VARIANTS[variant],
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-5)]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          // `plat` so the tokens resolve: this renders in document.body.
          className={cn(
            'plat z-[90] max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden',
            'rounded-[12px] border border-[var(--line)] bg-[var(--paper)] p-1',
            'shadow-[0_18px_40px_-18px_color-mix(in_srgb,var(--ink)_34%,transparent)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex justify-center py-1 text-[var(--text-5)]">
            <ChevronDown className="h-3 w-3 rotate-180" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport>{renderOptions(children)}</SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex justify-center py-1 text-[var(--text-5)]">
            <ChevronDown className="h-3 w-3" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
