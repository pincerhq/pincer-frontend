/**
 * There are no "AI employees": a Pincer install is one agent. The visible copy
 * says so — the owner's exact sentences are pinned here, and plural-agent
 * phrasing may not creep back into the pages. The login headline "An AI
 * workforce that starts before you do" stays by the owner's ruling.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8').replace(/\s+/g, ' ');

const KEPT_HEADLINE = 'An AI workforce that starts before you do';

describe('copy describes the one Pincer agent', () => {
  it.each([
    ['pages/Login.tsx', 'Sign in to chat with your Pincer agent, see what it handled on calls and tasks, and approve anything that needs you.'],
    ['pages/ForgotPassword.tsx', 'Your agent keeps working in the meantime.'],
    ['pages/Chat.tsx', 'Chat with your Pincer agent or ask anything'],
    ['pages/Dashboard.tsx', 'What your agent is doing, at a glance'],
    ['pages/Dashboard.tsx', "sub: 'Talk to your agent'"],
    ['pages/Signup.tsx', 'Put your Pincer agent to work today'],
    ['pages/Login.tsx', KEPT_HEADLINE],
  ])('%s says "%s"', (file, sentence) => {
    expect(read(file)).toContain(sentence);
  });

  it('no page or component speaks of AI employees, AI workers or several agents', () => {
    const files = (dir: string): string[] =>
      readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx$/.test(e.name) ? [path.join(dir, e.name)] : [],
      );
    const hits = [...files('pages'), ...files('components')].flatMap((file) => {
      const text = read(file).split(KEPT_HEADLINE).join('');
      return [/AI employees?/i, /AI workers?/i, /AI workforce/i, /your agents\b/i]
        .filter((re) => re.test(text))
        .map((re) => `${file} ${re}`);
    });
    expect(hits).toEqual([]);
  });

  it('the dead cross-company marketing block is gone from both locales', () => {
    for (const lang of ['en', 'de']) {
      const product = JSON.parse(readFileSync(path.join(SRC, `i18n/locales/${lang}/translation.json`), 'utf8')).product ?? {};
      expect(product, lang).not.toHaveProperty('crossCompany');
    }
  });
});
