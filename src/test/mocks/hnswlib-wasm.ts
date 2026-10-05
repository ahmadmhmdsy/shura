/**
 * Mock for hnswlib-wasm in test environment.
 * The real WASM module can't load in jsdom.
 */

export const loadHnswlib = async () => ({
  HierarchicalNSW: class {
    initIndex() {}
    addPoint() {}
    searchKnn() {
      return { neighbors: [], distances: [] };
    }
  },
});
