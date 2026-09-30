import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { beforeEach, vi } from "vitest";

// Reset localStorage before each test and set onboarding as seen
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("shura-onboarding-seen", "true");
});

// Mock hnswlib-wasm (WASM module can't load in test environment)
vi.mock("hnswlib-wasm", () => ({
  loadHnswlib: async () => ({
    HierarchicalNSW: class {
      initIndex() {}
      addPoint() {}
      searchKnn() {
        return { neighbors: [], distances: [] };
      }
    },
  }),
}));

// Mock onnxruntime-web (WASM module can't load in test environment)
vi.mock("onnxruntime-web", () => ({
  env: { wasm: { wasmPaths: "" } },
  InferenceSession: {
    create: async () => ({
      run: async () => ({}),
    }),
  },
  Tensor: class {
    constructor(public type: string, public data: unknown, public dims: number[]) {}
  },
}));

// Mock pdfjs-dist (large module, not needed in most tests)
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: async () => ({
    promise: Promise.resolve({
      numPages: 0,
      getPage: async () => ({
        getTextContent: async () => ({ items: [] }),
      }),
    }),
  }),
}));
