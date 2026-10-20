// src/lib/api/storage.ts
// Company → Documents: the storage root Pincer serves at /api/storage (a
// local directory or a bucket, see the backend's PINCER_STORAGE_ROOT). All
// access goes through the API; the browser never holds storage credentials.
//
// Keys are POSIX paths relative to the root ("reports/q1.pdf"; "" is the
// root). Folders are keys too, without a trailing slash.
//
// Previews and downloads use presigned links (`presign`): an <img src> or a
// navigation cannot carry the bearer token. A cloud root's link points at the
// provider; a local root's is a path on the API, resolved here.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authHeaders, ensureFreshAuth, getAuth, isConnected, refreshSession, type PincerAuth } from "@/lib/pincerClient";
import { api, ApiError, qs, type Schema } from "./client";
import { getTenantId } from "./tenant";

export type StorageInfo = Schema<"StorageInfoOut">;
export type StorageListing = Schema<"ListingOut">;
export type StorageFolder = Schema<"FolderOut">;
export type StorageFile = Schema<"FileOut">;
export type StorageText = Schema<"TextOut">;
export type StorageTextSaved = Schema<"TextSavedOut">;
export type Presigned = Schema<"PresignOut">;
export type Disposition = "inline" | "attachment";

/** TanStack Query keys of the storage API. */
export const storageKeys = {
  info: ["storage", "info"] as const,
  /** Every listing, for invalidating after a change. */
  listAll: ["storage", "list"] as const,
  list: (prefix: string) => ["storage", "list", prefix] as const,
  text: (key: string) => ["storage", "text", key] as const,
  presign: (key: string, disposition: Disposition) => ["storage", "presign", key, disposition] as const,
};

/** What `presign_ttl` defaults to on the server, for when the info is not loaded. */
export const DEFAULT_PRESIGN_TTL_S = 900;

/**
 * How long a link fetched at `fetchedAt` stays usable: until its `expires_at`,
 * less a margin (10% of its life, at least 30 s) so it is not handed out just
 * before it runs out. 0 for a link without a readable expiry.
 */
export function presignStaleMs(link: Pick<Presigned, "expires_at">, fetchedAt: number): number {
  const expires = Date.parse(link.expires_at);
  if (Number.isNaN(expires)) return 0;
  const life = expires - fetchedAt;
  return Math.max(0, life - Math.max(life * 0.1, 30_000));
}

/** The last path segment of a key: "a/b/c.pdf" → "c.pdf". */
export function baseName(key: string): string {
  const trimmed = key.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The folder of a key: "a/b/c.pdf" → "a/b", "c.pdf" → "". */
export function parentOf(key: string): string {
  const trimmed = key.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i < 0 ? "" : trimmed.slice(0, i);
}

/** True for a protected prefix, anything inside one, and every folder above one (as the server decides). */
export function isProtectedKey(key: string, protectedPrefixes: readonly string[]): boolean {
  return protectedPrefixes.some(
    (p) => !p || !key || key === p || key.startsWith(`${p}/`) || p.startsWith(`${key}/`),
  );
}

// ── Reads ────────────────────────────────────────────────────────────

export function useStorageInfo() {
  return useQuery<StorageInfo, ApiError>({
    queryKey: storageKeys.info,
    queryFn: () => api.get<StorageInfo>("/api/storage"),
    enabled: isConnected(),
    staleTime: 5 * 60 * 1000,
  });
}

/** Entries per listing page (the server allows 1–100). */
export const LIST_PAGE_SIZE = 50;

/**
 * A folder, a page at a time: `fetchNextPage()` loads the next `LIST_PAGE_SIZE`
 * entries while `hasNextPage`. Pages come folders first, then files, by name.
 */
export function useStorageList(prefix: string) {
  return useInfiniteQuery<StorageListing, ApiError, { pages: StorageListing[] }, readonly unknown[], string | null>({
    queryKey: storageKeys.list(prefix),
    queryFn: ({ pageParam }) =>
      api.get<StorageListing>(`/api/storage/list${qs({ prefix, cursor: pageParam, limit: LIST_PAGE_SIZE })}`),
    initialPageParam: null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: isConnected(),
  });
}

export function useTextFile(key: string | null) {
  return useQuery<StorageText, ApiError>({
    queryKey: storageKeys.text(key ?? ""),
    queryFn: () => api.get<StorageText>(`/api/storage/text${qs({ key })}`),
    enabled: isConnected() && !!key,
    // What is on screen is what an edit is based on: never swap it in the background.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** A local root's link is a path on the API; make it absolute. */
function absoluteUrl(url: string): string {
  if (!url.startsWith("/")) return url;
  const auth = getAuth();
  return `${auth?.apiUrl ?? ""}${url}`;
}

/** A link that serves `key` without the bearer token, until its `expires_at` (`presign_ttl` from now). */
export async function presign(key: string, disposition: Disposition = "attachment"): Promise<Presigned> {
  const res = await api.get<Presigned>(`/api/storage/presign${qs({ key, disposition })}`);
  return { ...res, url: absoluteUrl(res.url) };
}

/** `presign` as a query: fresh for a little less than the link lives, so a reopened preview gets a new one. */
export function usePresignedUrl(key: string | null, disposition: Disposition, enabled = true) {
  const queryClient = useQueryClient();
  const ttl = queryClient.getQueryData<StorageInfo>(storageKeys.info)?.presign_ttl ?? DEFAULT_PRESIGN_TTL_S;
  return useQuery<Presigned, ApiError>({
    queryKey: storageKeys.presign(key ?? "", disposition),
    queryFn: () => presign(key as string, disposition),
    enabled: isConnected() && !!key && enabled,
    staleTime: (query) => (query.state.data ? presignStaleMs(query.state.data, query.state.dataUpdatedAt) : 0),
    // Past its life a cached link is useless: drop it then.
    gcTime: ttl * 1000,
    refetchOnWindowFocus: false,
  });
}

// ── Writes ───────────────────────────────────────────────────────────

function useInvalidateListings() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: storageKeys.listAll });
}

export function useSaveText() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateListings();
  return useMutation<StorageTextSaved, ApiError, { key: string; content: string; etag?: string | null }>({
    mutationFn: ({ key, content, etag }) =>
      api.put<StorageTextSaved>("/api/storage/text", { key, content, etag: etag ?? null }),
    onSuccess: (saved, { content }) => {
      queryClient.setQueryData<StorageText>(storageKeys.text(saved.key), {
        key: saved.key,
        content,
        etag: saved.etag,
        size: saved.size,
      });
      void invalidate();
    },
  });
}

export function useMkdir() {
  const invalidate = useInvalidateListings();
  return useMutation<StorageFolder, ApiError, string>({
    mutationFn: (prefix) => api.post<StorageFolder>("/api/storage/folders", { prefix }),
    onSuccess: () => void invalidate(),
  });
}

export function useMove() {
  const invalidate = useInvalidateListings();
  return useMutation<{ from: string; to: string }, ApiError, { from: string; to: string; overwrite?: boolean }>({
    mutationFn: ({ from, to, overwrite }) =>
      api.post<{ from: string; to: string }>("/api/storage/move", { from, to, overwrite: overwrite ?? false }),
    onSuccess: () => void invalidate(),
  });
}

export function useDelete() {
  const invalidate = useInvalidateListings();
  return useMutation<Schema<"DeletedOut">, ApiError, { key: string; folder: boolean }>({
    mutationFn: ({ key, folder }) =>
      api.del<Schema<"DeletedOut">>(`/api/storage/object${qs(folder ? { prefix: key } : { key })}`),
    onSuccess: () => void invalidate(),
  });
}

// ── Upload (XHR, for progress) ───────────────────────────────────────

export interface UploadOptions {
  overwrite?: boolean;
  signal?: AbortSignal;
  /** Bytes sent so far of this file. */
  onProgress?: (loaded: number, total: number) => void;
}

function tenantHeaders(): Record<string, string> {
  const tenant = getTenantId();
  return tenant ? { "X-Pincer-Tenant": tenant, "X-Tenant-Id": tenant } : {};
}

function sendUpload(
  auth: PincerAuth,
  prefix: string,
  file: File,
  opts: UploadOptions,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${auth.apiUrl}/api/storage/upload${qs({ prefix, overwrite: opts.overwrite || undefined })}`);
    for (const [name, value] of Object.entries({ ...authHeaders(auth), ...tenantHeaders() })) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (e) => opts.onProgress?.(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ApiError("Upload failed: the server could not be reached", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled", 0));
    if (opts.signal) {
      if (opts.signal.aborted) return reject(new ApiError("Upload cancelled", 0));
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    const form = new FormData();
    // A file from a folder pick keeps its folder ("reports/q1.pdf").
    form.append("files", file, file.webkitRelativePath || file.name);
    xhr.send(form);
  });
}

/**
 * Upload one file into `prefix`. A 409 means the key exists; call again with
 * `overwrite: true` to replace it.
 */
export async function uploadFile(prefix: string, file: File, opts: UploadOptions = {}): Promise<StorageFile> {
  let auth = await ensureFreshAuth();
  if (!auth) throw new ApiError("Not signed in", 401);
  let res = await sendUpload(auth, prefix, file, opts);
  // Expired in flight: one refresh and one retry, as authedFetch does.
  if (res.status === 401 && (res.body as { error?: string } | null)?.error === "token_expired") {
    if ((await refreshSession(auth.token)) === "ok" && (auth = await ensureFreshAuth())) {
      res = await sendUpload(auth, prefix, file, opts);
    }
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = (res.body as { detail?: unknown } | null)?.detail;
    throw new ApiError(typeof detail === "string" ? detail : `HTTP ${res.status}`, res.status);
  }
  return (res.body as { files: StorageFile[] }).files[0];
}
