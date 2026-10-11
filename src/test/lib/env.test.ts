import { afterEach, describe, expect, it } from 'vitest';
import { env } from '@/lib/env';

afterEach(() => {
  delete window.__ENV__;
});

describe('env', () => {
  it('is undefined when /config.js never ran', () => {
    expect(env('VITE_NOTES_API_URL')).toBeUndefined();
  });

  it('is undefined for a variable that is not set', () => {
    window.__ENV__ = { SIGNUP_ALLOWED: 'true' };
    expect(env('VITE_NOTES_API_URL')).toBeUndefined();
  });

  it.each(['', '   '])('treats %j as unset', (value) => {
    window.__ENV__ = { VITE_NOTES_API_URL: value };
    expect(env('VITE_NOTES_API_URL')).toBeUndefined();
  });

  it('trims the value', () => {
    window.__ENV__ = { VITE_NOTES_API_URL: '  /notes-api\n' };
    expect(env('VITE_NOTES_API_URL')).toBe('/notes-api');
  });

  it('reads the global on every call', () => {
    window.__ENV__ = { SIGNUP_ALLOWED: 'false' };
    expect(env('SIGNUP_ALLOWED')).toBe('false');
    window.__ENV__ = { SIGNUP_ALLOWED: 'true' };
    expect(env('SIGNUP_ALLOWED')).toBe('true');
  });
});
