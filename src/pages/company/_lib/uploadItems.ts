/**
 * What the Documents view uploads: each file with the path it is stored under,
 * relative to the open folder. A file picked on its own is its name; a file
 * from a picked or dropped folder keeps that folder ("reports/2026/q1.pdf").
 */

export interface UploadItem {
  file: File;
  path: string;
}

/** Files from an `<input type="file">`, with or without `webkitdirectory`. */
export function pickedItems(files: Iterable<File>): UploadItem[] {
  return Array.from(files, (file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/**
 * Files from a drop, dropped folders walked. A dropped folder in `files` is
 * an unreadable stand-in, so folders are read through `webkitGetAsEntry()`.
 *
 * The entries are taken before the first `await`: the browser empties the
 * DataTransfer once the drop event has been dispatched. An aborted `signal`
 * stops the walk, which rejects.
 */
export async function droppedItems(transfer: DataTransfer, signal?: AbortSignal): Promise<UploadItem[]> {
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  if (entries.length === 0 || entries.includes(null)) return pickedItems(transfer.files);
  const items: UploadItem[] = [];
  for (const entry of entries as FileSystemEntry[]) await walk(entry, '', items, signal);
  return items;
}

async function walk(entry: FileSystemEntry, folder: string, into: UploadItem[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const path = folder ? `${folder}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    into.push({ file, path });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries answers in batches (100 at a time in Chrome) until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return;
    for (const child of batch) await walk(child, path, into, signal);
  }
}
