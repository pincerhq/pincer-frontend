/** How the Documents view and its file dialog classify and describe files. */
import type { StorageFile } from '@/lib/api/storage';

/** The largest file the editor opens (the server's limit too). */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const MARKDOWN_EXT = new Set(['md', 'markdown']);
const TEXT_EXT = new Set([
  'txt', 'text', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'xml', 'html', 'htm', 'css', 'scss', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
  'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql', 'r', 'tex', 'rst', 'properties',
]);
const TEXT_TYPES = ['application/json', 'application/xml', 'application/x-yaml', 'application/yaml', 'application/toml'];

export type FileKind = 'image' | 'markdown' | 'text' | 'other';

/** What the dialog shows for a file: decided by extension, then by content type. */
export function fileKind(file: Pick<StorageFile, 'name' | 'content_type' | 'size'>): FileKind {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const type = (file.content_type || '').toLowerCase();
  if (IMAGE_EXT.has(ext) || type.startsWith('image/')) return 'image';
  const tooBig = file.size != null && file.size > MAX_TEXT_BYTES;
  if (MARKDOWN_EXT.has(ext) || type === 'text/markdown') return tooBig ? 'other' : 'markdown';
  if (TEXT_EXT.has(ext) || type.startsWith('text/') || TEXT_TYPES.includes(type)) return tooBig ? 'other' : 'text';
  return 'other';
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
