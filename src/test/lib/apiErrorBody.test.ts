/**
 * An HTTP error keeps the JSON body it came with, so a caller can tell the
 * API's own answer from an HTML page standing where the API should be.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, publicRequest } from '@/lib/api/client';

function respond(status: number, body: string, contentType: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } })));
}

async function failure(): Promise<ApiError> {
  try {
    await publicRequest('http://pincer.test', '/api/health');
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected the request to fail');
}

describe('ApiError.body', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a JSON error keeps its body', async () => {
    respond(404, '{"detail":"Not Found"}', 'application/json');
    const err = await failure();
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ detail: 'Not Found' });
  });

  it('an HTML error page has none', async () => {
    respond(404, '<!doctype html><title>Not found</title>', 'text/html');
    expect((await failure()).body).toBeUndefined();
  });

  it('an HTML 200 (the SPA where the API should be) is reported as a missing endpoint, with no body', async () => {
    respond(200, '<!doctype html><div id="root"></div>', 'text/html');
    const err = await failure();
    expect(err.status).toBe(404);
    expect(err.body).toBeUndefined();
  });
});
