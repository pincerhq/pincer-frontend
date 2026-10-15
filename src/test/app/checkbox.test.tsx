/**
 * The shared checkbox pins its own corner radius. Its old `rounded-sm` came
 * from the root --radius (0.75rem − 4px = 8px), which on a 16px box is a
 * circle — on the sign-in page "Remember me" read as a radio button.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Checkbox } from '@/components/ui/checkbox';

describe('checkbox', () => {
  it('has a fixed 4px corner, not one derived from --radius', () => {
    render(<Checkbox aria-label="Remember me" />);
    const box = screen.getByRole('checkbox', { name: 'Remember me' });
    expect(box.className.split(' ')).toContain('rounded-[4px]');
    expect(box.className).not.toMatch(/\brounded-(sm|md|lg)\b/);
  });
});
