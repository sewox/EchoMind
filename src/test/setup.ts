import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock Tauri API core and event
export const globalTestEventListeners: Record<
  string,
  ((event: any) => void)[]
> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: (e: any) => void) => {
    if (!globalTestEventListeners[event]) {
      globalTestEventListeners[event] = [];
    }
    globalTestEventListeners[event].push(cb);
    return Promise.resolve(() => {
      globalTestEventListeners[event] = (
        globalTestEventListeners[event] || []
      ).filter((fn) => fn !== cb);
    });
  }),
  emit: vi.fn(),
}));

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock window.matchMedia
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock URL.createObjectURL and URL.revokeObjectURL
if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
}
if (!window.URL.revokeObjectURL) {
  window.URL.revokeObjectURL = vi.fn();
}
