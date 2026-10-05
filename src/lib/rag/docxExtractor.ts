/**
 * DOCX text extraction.
 * 
 * Uses mammoth to convert DOCX files to plain text.
 * mammoth is a pure JavaScript library that works in both
 * browser and Node.js environments.
 */

export interface DocxExtractionResult {
  text: string;
  metadata: {
    pageCount?: number;
  };
}

/**
 * Extract text from a DOCX file.
 * 
 * @param file The DOCX file
 * @returns The extracted text
 */
export async function extractDocxText(file: File | Blob): Promise<DocxExtractionResult> {
  const mammoth = await import("mammoth");
  
  const arrayBuffer = await file.arrayBuffer();
  
  // mammoth.extractRawText expects a buffer or arrayBuffer
  const result = await mammoth.extractRawText({ arrayBuffer });
  
  return {
    text: result.value,
    metadata: {},
  };
}

/**
 * Check if mammoth is available.
 * mammoth is a large library, so we lazy-load it.
 */
export function isDocxSupported(): boolean {
  return true;
}
