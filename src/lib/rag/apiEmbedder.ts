/**
 * API-based embedder for hybrid mode.
 * 
 * Uses an external API for embeddings instead of local ONNX inference.
 * Useful when:
 * - Local model is not available
 * - Higher quality embeddings are needed
 * - User wants to use the same provider for embeddings and chat
 * 
 * The API endpoint should accept:
 *   POST /embeddings
 *   { "model": "...", "input": ["text1", "text2", ...] }
 * 
 * And return:
 *   { "data": [{ "embedding": [0.1, 0.2, ...] }, ...] }
 */

export interface ApiEmbedderOptions {
  providerId: string;
  apiKey: string;
  baseURL: string;
  modelId: string;
  dimensions: number;
}

/**
 * API-based embedder.
 * Follows the same interface as OnnxEmbedder for easy swapping.
 */
export class ApiEmbedder {
  private options: ApiEmbedderOptions;

  constructor(options: ApiEmbedderOptions) {
    this.options = options;
  }

  get modelId(): string {
    return this.options.modelId;
  }

  get dimensions(): number {
    return this.options.dimensions;
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  /**
   * Embed multiple texts in batch.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const { apiKey, baseURL, modelId } = this.options;
    
    const response = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Invalid embedding API response");
    }

    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }
}

/**
 * Create an API embedder from provider configuration.
 */
export function createApiEmbedder(
  providerId: string,
  apiKey: string,
  baseURL: string,
  modelId: string,
  dimensions: number = 384,
): ApiEmbedder {
  return new ApiEmbedder({
    providerId,
    apiKey,
    baseURL,
    modelId,
    dimensions,
  });
}

/**
 * Check if a provider supports embeddings.
 */
export function providerSupportsEmbeddings(providerId: string): boolean {
  // OpenRouter and OpenAI-compatible providers typically support embeddings
  const supported = ["openrouter", "google", "minimax", "opencodego"];
  return supported.includes(providerId);
}

/**
 * Get the default embedding model for a provider.
 */
export function getDefaultEmbeddingModel(providerId: string): { modelId: string; dimensions: number } {
  const defaults: Record<string, { modelId: string; dimensions: number }> = {
    openrouter: { modelId: "text-embedding-3-small", dimensions: 1536 },
    google: { modelId: "text-embedding-004", dimensions: 768 },
    minimax: { modelId: "embo-01", dimensions: 768 },
    opencodego: { modelId: "text-embedding-3-small", dimensions: 1536 },
  };
  return defaults[providerId] ?? { modelId: "text-embedding-3-small", dimensions: 1536 };
}
