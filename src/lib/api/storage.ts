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

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  authHeaders,
  ensureFreshAuth,
  getAuth,
  isConnected,
  loseSession,
  refreshSession,
  type PincerAuth,
} from "@/lib/pincerClient";
import { api, ApiError, normalizeErrorBody, qs, type Schema } from "./client";
import { getTenantId } from "./tenant";

export type StorageInfo = Schema<"StorageInfoOut">;
export type StorageListing = Schema<"ListingOut">;
export type StorageFolder = Schema<"FolderOut">;
export type StorageFile = Schema<"FileOut">;
export type StorageText = Schema<"TextOut">;
export type StorageTextSaved = Schema<"TextSavedOut">;
export type Presigned = Schema<"PresignOut">;
export type Disposition = "inline" | "attachment";
/** A presigned link and how long it lives from when it arrived (ms). */
export type PresignedLink = Presigned & { lifeMs: number };

/** TanStack Query keys of the storage API: the one place they are defined. */
export const storageKeys = {
  info: ["storage", "info"] as const,
  /** Every listing, for invalidating after a change. */
  listAll: ["storage", "list"] as const,
  list: (prefix: string) => ["storage", "list", prefix] as const,
  /** Every loaded text file, for invalidating after a change. */
  textAll: ["storage", "text"] as const,
  text: (key: string) => ["storage", "text", key] as const,
  presign: (key: string, disposition: Disposition) => ["storage", "presign", key, disposition] as const,
};

/** What `presign_ttl` defaults to on the server, for when the info is not loaded. */
export const DEFAULT_PRESIGN_TTL_S = 900;

/**
 * How long a link that lives `lifeMs` is handed out: its life less a margin
 * (10% of it, at least 30 s), so it is not used just before it runs out. The
 * margin also covers the moments between the server signing it and it arriving.
 */
export function presignStaleMs(lifeMs: number): number {
  return Math.max(0, lifeMs - Math.max(lifeMs * 0.1, 30_000));
}

/**
 * A link's life, counted on the client's clock. From the server's
 * `presign_ttl` when known: `expires_at` is server time, and subtracting the
 * client's `Date.now()` from it would shift the window by the clock skew. A
 * link without either is treated as already stale.
 */
export function presignLifeMs(link: Pick<Presigned, "expires_at">, ttlSeconds: number | undefined, now = Date.now()) {
  if (ttlSeconds) return ttlSeconds * 1000;
  const expires = Date.parse(link.expires_at);
  return Number.isNaN(expires) ? 0 : Math.max(0, expires - now);
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

const storageInfoQuery = {
  queryKey: storageKeys.info,
  queryFn: () => api.get<StorageInfo>("/api/storage"),
  staleTime: 5 * 60 * 1000,
};

export function useStorageInfo() {
  return useQuery<StorageInfo, ApiError>({ ...storageInfoQuery, enabled: isConnected() });
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

/**
 * `presign` as a query: fresh for a little less than the link lives. A link on
 * screen is replaced before it runs out, so "Open in new tab" and the image
 * keep working however long the dialog stays open; a reopened preview gets a
 * new one too.
 */
export function usePresignedUrl(key: string | null, disposition: Disposition, enabled = true) {
  const queryClient = useQueryClient();
  const ttl = useStorageInfo().data?.presign_ttl ?? DEFAULT_PRESIGN_TTL_S;
  const handOutMs = (link: PresignedLink | undefined) => (link ? presignStaleMs(link.lifeMs) : 0);
  return useQuery<PresignedLink, ApiError>({
    queryKey: storageKeys.presign(key ?? "", disposition),
    queryFn: async () => {
      // The TTL the link was signed with; without it, its expires_at is all there is.
      const info = await queryClient.ensureQueryData<StorageInfo>(storageInfoQuery).catch(() => undefined);
      const link = await presign(key as string, disposition);
      return { ...link, lifeMs: presignLifeMs(link, info?.presign_ttl) };
    },
    enabled: isConnected() && !!key && enabled,
    staleTime: (query) => handOutMs(query.state.data),
    refetchInterval: (query) => handOutMs(query.state.data) || false,
    // A link that went stale while the tab was hidden is replaced on return; a fresh one is kept.
    refetchOnWindowFocus: true,
    // Past its life a cached link is useless: drop it then.
    gcTime: ttl * 1000,
  });
}

// ── Writes ───────────────────────────────────────────────────────────

/**
 * After files changed: every listing is refetched, and every loaded text file
 * is marked stale without a background refetch (an open editor's base must
 * not change under it), so reopening one reads it again.
 */
export function invalidateStorage(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: storageKeys.listAll }),
    queryClient.invalidateQueries({ queryKey: storageKeys.textAll, refetchType: "none" }),
  ]);
}

function useInvalidateListings() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: storageKeys.listAll });
}

function useInvalidateStorage() {
  const queryClient = useQueryClient();
  return () => invalidateStorage(queryClient);
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
  const invalidate = useInvalidateStorage();
  return useMutation<{ from: string; to: string }, ApiError, { from: string; to: string; overwrite?: boolean }>({
    mutationFn: ({ from, to, overwrite }) =>
      api.post<{ from: string; to: string }>("/api/storage/move", { from, to, overwrite: overwrite ?? false }),
    onSuccess: () => void invalidate(),
  });
}

export function useDelete() {
  const invalidate = useInvalidateStorage();
  return useMutation<Schema<"DeletedOut">, ApiError, { key: string; folder: boolean }>({
    mutationFn: ({ key, folder }) =>
      api.del<Schema<"DeletedOut">>(`/api/storage/object${qs(folder ? { prefix: key } : { key })}`),
    onSuccess: () => void invalidate(),
  });
}

// ── Upload (XHR, for progress) ───────────────────────────────────────

export interface UploadOptions {
  /** The key under `prefix`, may hold subfolders ("reports/q1.pdf"). Default: the file's folder-pick path, or its name. */
  path?: string;
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
    // The server stores a name with slashes in its subfolders ("reports/q1.pdf").
    form.append("files", file, opts.path || file.webkitRelativePath || file.name);
    xhr.send(form);
  });
}

/** The auth layer's `error` code of a 401 body, if it carries one. */
function authCode(body: unknown): string | undefined {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof code === "string" && code ? code : undefined;
}

/**
 * Upload one file into `prefix`. A 409 means the key exists; call again with
 * `overwrite: true` to replace it.
 *
 * A 401 is handled as `authedFetch` handles it: `token_expired` refreshes and
 * retries once; `invalid_token`, a rejected refresh or a second 401 ends the
 * session. A 401 without an auth code, or a refresh that could not be
 * reached, leaves the session alone.
 */
export async function uploadFile(prefix: string, file: File, opts: UploadOptions = {}): Promise<StorageFile> {
  const auth = await ensureFreshAuth();
  if (!auth) throw new ApiError("Not signed in", 401);
  let res = await sendUpload(auth, prefix, file, opts);
  if (res.status === 401) {
    const code = authCode(res.body);
    if (code === "token_expired") {
      const result = await refreshSession(auth.token);
      if (result !== "unavailable") {
        const next = result === "ok" ? getAuth() : null;
        if (next) res = await sendUpload(next, prefix, file, opts);
        if (!next || res.status === 401) loseSession();
      }
    } else if (code === "invalid_token") {
      loseSession();
    }
  }
  if (res.status < 200 || res.status >= 300) {
    const { detail, fields } = normalizeErrorBody(res.body, res.status);
    throw new ApiError(detail, res.status, fields, authCode(res.body));
  }
  return (res.body as { files: StorageFile[] }).files[0];
}
