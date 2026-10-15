/**
 * Browser storage can refuse service: Safari private mode, blocked site data,
 * a full quota. The app must still render and work for the page's lifetime —
 * it just cannot remember anything across reloads. These are the three ways
 * it refuses, as a real browser presents them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getUserId, resetUserId } from "@/lib/pincerClient";

const denied = () => {
  throw new DOMException("denied", "SecurityError");
};

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;

const BLOCKS = {
  "getItem throws": () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(denied);
  },
  "getItem and setItem throw": () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(denied);
    vi.spyOn(localStorage, "setItem").mockImplementation(denied);
  },
  "the localStorage getter throws": () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: denied });
  },
} as const;

const blocks = Object.entries(BLOCKS);

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "localStorage", original);
  localStorage.clear();
});

describe("Pincer user id", () => {
  it("is persisted and stable with working storage, and a reset persists too", () => {
    const id = getUserId();
    expect(localStorage.getItem("pincer.web.userId")).toBe(id);
    expect(getUserId()).toBe(id);

    const next = resetUserId();
    expect(localStorage.getItem("pincer.web.userId")).toBe(next);
    expect(getUserId()).toBe(next);
  });

  it.each(blocks)("is stable for the page when %s", (_, block) => {
    block();
    const id = getUserId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getUserId()).toBe(id);
  });

  it.each(blocks)("can be reset, and the new id sticks, when %s", (_, block) => {
    block();
    const before = getUserId();
    const after = resetUserId();
    expect(after).not.toBe(before);
    expect(getUserId()).toBe(after);
  });
});

/**
 * What actually blanked the page: both of these run while modules load, so a
 * throw there means React never mounts. Load them fresh under each block.
 */
describe("boot with storage blocked", () => {
  it.each(blocks)("creates the session store when %s", async (_, block) => {
    block();
    vi.resetModules();
    const { useSession } = await import("@/stores/session");
    expect(useSession.getState().userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(blocks)("initialises i18n when %s", async (_, block) => {
    block();
    vi.resetModules();
    const { default: i18n } = await import("@/i18n");
    expect(i18n.isInitialized).toBe(true);
  });
});

describe("language detection with working storage", () => {
  it("still prefers the stored language over the browser's", async () => {
    localStorage.setItem("i18nextLng", "de");
    vi.resetModules();
    const { default: i18n } = await import("@/i18n");
    expect(i18n.language).toBe("de");
  });

  it("still remembers a chosen language under the same key", async () => {
    vi.resetModules();
    const { default: i18n } = await import("@/i18n");
    await i18n.changeLanguage("de");
    expect(localStorage.getItem("i18nextLng")).toBe("de");
  });
});
