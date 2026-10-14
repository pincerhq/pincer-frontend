import React from 'react';

/**
 * Strip model-internal artifacts that sometimes leak into Pincer's reply
 * stream (tool-call XML, system reminders, partial trailing tags) so the
 * chat bubble shows only the user-facing answer.
 *
 * Tolerant of partial / still-streaming text:
 *   - balanced blocks are removed first
 *   - any unclosed leading tag is stripped to the end
 *   - a dangling partial open-tag at the end is dropped
 */
export function cleanAssistantText(raw: string): string {
  if (!raw) return '';
  let s = raw;

  // Balanced internal blocks
  s = s.replace(/<function_calls>[\s\S]*?<\/antml:function_calls>/g, '');
  s = s.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '');
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');

  // Unclosed (still-streaming) blocks
  s = s.replace(/<function_calls>[\s\S]*$/g, '');
  s = s.replace(/<function_calls>[\s\S]*$/g, '');
  s = s.replace(/<system-reminder>[\s\S]*$/g, '');
  s = s.replace(/<thinking>[\s\S]*$/g, '');

  // Stray individual tags
  s = s.replace(
    /<\/?(antml:function_calls|antml:invoke|antml:parameter|function_calls|invoke|parameter|system-reminder|thinking)\b[^>]*>/g,
    '',
  );

  // Dangling partial tag at end of stream
  s = s.replace(/<[a-zA-Z][a-zA-Z0-9:_-]*[^>]*$/, '');

  // Strip standalone JSON tool-result blocks that leak into the chunk
  // stream (e.g. `{"success": true, "events": []}` between paragraphs).
  s = stripJsonBlocks(s);

  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * Remove top-level JSON object/array blocks that appear on their own
 * (outside fenced code). Walks the string, finds a `{`/`[` at a line/
 * whitespace boundary, locates its matching close while respecting
 * string literals, and only strips if the candidate parses as JSON.
 */
function stripJsonBlocks(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    // Preserve fenced code blocks verbatim.
    if (s.startsWith('```', i)) {
      const end = s.indexOf('```', i + 3);
      if (end === -1) {
        out += s.slice(i);
        return out;
      }
      out += s.slice(i, end + 3);
      i = end + 3;
      continue;
    }

    const ch = s[i];
    const atBoundary = i === 0 || s[i - 1] === '\n' || s[i - 1] === ' ' || s[i - 1] === '\t';
    if ((ch === '{' || ch === '[') && atBoundary) {
      const close = ch === '{' ? '}' : ']';
      let depth = 0;
      let j = i;
      let inStr = false;
      let esc = false;
      while (j < s.length) {
        const c = s[j];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') {
          inStr = true;
        } else if (c === ch) {
          depth++;
        } else if (c === close) {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
        j++;
      }
      if (depth === 0 && j > i) {
        const candidate = s.slice(i, j);
        try {
          JSON.parse(candidate);
          i = j;
          if (s[i] === '\n') i++;
          continue;
        } catch {
          // Not valid JSON — emit the original character and move on.
        }
      }
    }

    out += ch;
    i++;
  }
  return out;
}

// Match an http(s) URL starting at `start`, tolerating common quirks:
//   - trailing sentence punctuation isn't part of the URL
//   - a URL wrapped as `<https://...>` shouldn't include the closing `>`
//   - Google-Calendar-style eid params can contain a literal space that
//     should have been %20-encoded; if the URL has a query string and the
//     next token looks like a base64 continuation, fold it back in
function matchUrl(line: string, start: number): { url: string; end: number } | null {
  if (!line.startsWith('http://', start) && !line.startsWith('https://', start)) return null;
  const m = line.slice(start).match(/^https?:\/\/[^\s<>)\]]+/);
  if (!m) return null;
  let url = m[0].replace(/[.,;:!?'"`)\]>]+$/, '');
  let end = start + url.length;
  if (url.includes('?')) {
    const after = line.slice(end);
    const cont = after.match(/^[ \t]+([A-Za-z0-9+/=_-]{6,})(?=$|[\s.,;:!?'"`)\]>])/);
    if (cont && /\d/.test(cont[1])) {
      url += cont[0];
      end += cont[0].length;
    }
  }
  if (url.length <= 'https://'.length) return null;
  return { url, end };
}

function renderInline(line: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buf = '';
  let i = 0;
  let key = 0;
  const flush = () => {
    if (buf) {
      out.push(<React.Fragment key={`${keyPrefix}-t-${key++}`}>{buf}</React.Fragment>);
      buf = '';
    }
  };
  while (i < line.length) {
    const ch = line[i];

    if (ch === '`') {
      const end = line.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push(
          <code
            key={`${keyPrefix}-c-${key++}`}
            className="px-1 py-0.5 rounded bg-[color:var(--sand)] text-[0.85em] font-mono text-[color:var(--ink)]"
          >
            {line.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }

    if (ch === '*' && line[i + 1] === '*') {
      const end = line.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        out.push(
          <strong key={`${keyPrefix}-b-${key++}`} className="font-semibold">
            {line.slice(i + 2, end)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    if (ch === '*' && line[i + 1] !== '*' && line[i + 1] !== ' ') {
      const end = line.indexOf('*', i + 1);
      if (end !== -1 && line[end - 1] !== ' ') {
        flush();
        out.push(<em key={`${keyPrefix}-i-${key++}`}>{line.slice(i + 1, end)}</em>);
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const closeBracket = line.indexOf(']', i + 1);
      if (closeBracket !== -1 && line[closeBracket + 1] === '(') {
        const closeParen = line.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          flush();
          out.push(
            <a
              key={`${keyPrefix}-l-${key++}`}
              href={line.slice(closeBracket + 2, closeParen)}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--brand)] hover:underline break-all"
            >
              {line.slice(i + 1, closeBracket)}
            </a>,
          );
          i = closeParen + 1;
          continue;
        }
      }
    }

    if (ch === 'h' && (line.startsWith('http://', i) || line.startsWith('https://', i))) {
      const matched = matchUrl(line, i);
      if (matched) {
        flush();
        out.push(
          <a
            key={`${keyPrefix}-u-${key++}`}
            href={matched.url.replace(/\s+/g, '%20')}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--brand)] hover:underline break-all"
          >
            {matched.url}
          </a>,
        );
        i = matched.end;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

/**
 * Render assistant text as React nodes with light markdown support
 * (paragraphs, headings, bullet/numbered lists, code fences, inline
 * code/bold/italic/links). Input is cleaned first.
 */
export function renderAssistantText(raw: string): React.ReactNode {
  const text = cleanAssistantText(raw);
  if (!text) return null;

  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let bk = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      // Theme exception: fenced code stays a dark surface in both themes.
      blocks.push(
        <pre
          key={`b-${bk++}`}
          className="my-2 p-3 rounded-lg bg-gray-900 text-gray-100 text-xs overflow-x-auto font-mono leading-relaxed"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? 'text-base font-semibold mt-3 mb-1 text-[color:var(--ink)]'
          : level === 2
            ? 'text-sm font-semibold mt-2.5 mb-1 text-[color:var(--ink)]'
            : 'text-sm font-medium mt-2 mb-0.5 text-[color:var(--ink)]';
      const Tag = (level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4';
      blocks.push(
        <Tag key={`b-${bk++}`} className={cls}>
          {renderInline(heading[2], `b${bk}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`b-${bk++}`} className="my-1.5 ml-5 list-disc space-y-1">
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(it, `b${bk}-${idx}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`b-${bk++}`} className="my-1.5 ml-5 list-decimal space-y-1">
          {items.map((it, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(it, `b${bk}-${idx}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`b-${bk++}`} className="leading-relaxed">
        {paraLines.map((pl, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(pl, `b${bk}-${idx}`)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  return <div className="space-y-1.5">{blocks}</div>;
}

/**
 * Render plain user text, linkifying URLs and preserving line breaks.
 * No markdown — user typing should display literally.
 */
export function renderTextWithLinks(raw: string): React.ReactNode {
  if (!raw) return null;
  const lines = raw.split('\n');
  return (
    <>
      {lines.map((line, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <br />}
          {linkifyPlain(line, `u${idx}`)}
        </React.Fragment>
      ))}
    </>
  );
}

function linkifyPlain(line: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buf = '';
  let i = 0;
  let key = 0;
  const flush = () => {
    if (buf) {
      out.push(<React.Fragment key={`${keyPrefix}-t-${key++}`}>{buf}</React.Fragment>);
      buf = '';
    }
  };
  while (i < line.length) {
    if (
      line[i] === 'h' &&
      (line.startsWith('http://', i) || line.startsWith('https://', i))
    ) {
      const matched = matchUrl(line, i);
      if (matched) {
        flush();
        out.push(
          <a
            key={`${keyPrefix}-u-${key++}`}
            href={matched.url.replace(/\s+/g, '%20')}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--brand)] hover:underline break-all"
          >
            {matched.url}
          </a>,
        );
        i = matched.end;
        continue;
      }
    }
    buf += line[i];
    i++;
  }
  flush();
  return out;
}
