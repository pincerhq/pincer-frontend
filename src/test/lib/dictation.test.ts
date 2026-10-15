/**
 * Dictation's pure parts: which recognition language a UI language maps to,
 * how spoken text joins what was already typed, and how a session follows the
 * box through the user's edits.
 */
import { describe, it, expect } from 'vitest';
import { dictatedText, followDictation, NEW_TRACK, speechLang, type DictationTrack } from '@/lib/dictation';

describe('speechLang', () => {
  it.each([
    ['en', 'en-US'],
    ['en-GB', 'en-US'],
    ['de', 'de-DE'],
    ['de-AT', 'de-DE'],
    ['uk', 'uk-UA'],
    ['fr', 'fr'],
    [undefined, 'en-US'],
  ])('%s → %s', (ui, lang) => {
    expect(speechLang(ui)).toBe(lang);
  });
});

describe('dictatedText', () => {
  it.each([
    ['', 'hello there', 'hello there'],
    ['Draft', 'a reply', 'Draft a reply'],
    ['Draft ', 'a reply', 'Draft a reply'],
    ['Line one\n', 'line two', 'Line one\nline two'],
    ['Draft', '', 'Draft'],
    ['Draft', '  a reply', 'Draft a reply'],
  ])('%j + %j → %j', (typed, spoken, out) => {
    expect(dictatedText(typed, spoken)).toBe(out);
  });
});

/** A run of recognition updates against a box the user may edit in between. */
function run(steps: Array<{ edit: string } | Array<[string, boolean]>>, typed = '') {
  let track: DictationTrack = NEW_TRACK;
  let box = typed;
  for (const step of steps) {
    if (!Array.isArray(step)) {
      box = step.edit;
      continue;
    }
    const results = Object.assign(
      step.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
      { length: step.length },
    );
    ({ track, text: box } = followDictation(track, box, results));
  }
  return box;
}

describe('followDictation', () => {
  it('no edit: interim and final words follow what was typed', () => {
    expect(run([[['a reply', false]], [['a reply to Bob', true], [' about Friday', false]]], 'Draft')).toBe(
      'Draft a reply to Bob about Friday',
    );
  });

  it('edit mid-phrase: the words said after it in that phrase still land', () => {
    expect(run([
      [['book a table', false]],
      { edit: 'book a table,' },
      [['book a table for four at seven tonight', true]],
    ])).toBe('book a table, for four at seven tonight');
  });

  it('edit after a final: only what is said next is added', () => {
    expect(run([[['hello', true]], { edit: 'hello,' }, [['hello', true], [' there', false]]])).toBe('hello, there');
  });

  it('Chrome splits a phrase into interims, then merges them into one final', () => {
    expect(run([
      [['first', true], ['hello', false], [' world', false]],
      { edit: 'first hello world,' },
      [['first', true], ['hello world', true]],
      [['first', true], ['hello world', true], [' next phrase', false]],
    ])).toBe('first hello world, next phrase');
  });

  it('clearing the box: the cleared words never come back, new ones do', () => {
    expect(run([[['scratch that', false]], { edit: '' }, [['scratch that', true]]])).toBe('');
    expect(run([[['scratch that', false]], { edit: '' }, [['scratch that', true], [' new words', false]]])).toBe(
      'new words',
    );
  });

  it('a typed suffix is kept, and what is said next follows it', () => {
    expect(run([[['call Anna', true]], { edit: 'call Anna and' }, [['call Anna', true], [' Ben', false]]])).toBe(
      'call Anna and Ben',
    );
  });

  it('an interim revised after the edit ("for" → "four") is not appended again', () => {
    expect(run([[['table for', false]], { edit: 'table for!' }, [['table four', true]]])).toBe('table for!');
  });

  it('a second edit anchors on what is on screen then', () => {
    expect(run([
      [['one', false]],
      { edit: 'one,' },
      [['one two', false]],
      { edit: 'one, two.' },
      [['one two three', true]],
    ])).toBe('one, two. three');
  });
});
