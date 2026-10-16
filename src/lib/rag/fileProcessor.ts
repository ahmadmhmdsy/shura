/**
 * File format detection and text extraction.
 * Supports: txt, md, json, csv, log, pdf, docx
 */

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { extractDocxText } from "./docxExtractor";

export interface ExtractedText {
  text: string;
  metadata: {
    pageCount?: number;
    pageNumbers?: number[];
  };
}

/**
 * Detect file type from filename extension.
 */
export function detectFileType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const typeMap: Record<string, string> = {
    txt: "txt",
    md: "md",
    markdown: "md",
    json: "json",
    csv: "csv",
    log: "log",
    pdf: "pdf",
    docx: "docx",
  };
  return typeMap[ext] ?? "unknown";
}

/**
 * Check if a file type is supported.
 */
export function isSupportedFileType(fileName: string): boolean {
  return detectFileType(fileName) !== "unknown";
}

/**
 * Extract text from a file based on its type.
 */
export async function extractText(
  file: File | Blob,
  fileName: string,
): Promise<ExtractedText> {
  const fileType = detectFileType(fileName);

  switch (fileType) {
    case "pdf":
      return extractPdfText(file);
    case "docx":
      return extractDocxText(file);
    case "md":
    case "txt":
    case "json":
    case "csv":
    case "log": {
      const text = await file.text();
      return { text, metadata: {} };
    }
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Extract text from a PDF file.
 * Uses pdfjs-dist for pure JavaScript PDF parsing.
 */
async function extractPdfText(file: File | Blob): Promise<ExtractedText> {
  const pdfjsLib = await import("pdfjs-dist");
  
  // عامل pdf.js محلي (D3/ADR 0004): كان يُحمَّل من CDN فينفّذ كودًا بعيدًا.
  pdfjsLib.GlobalWorkerOptions.workerSrc = 
    pdfWorkerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = "";
  const pageNumbers: number[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    fullText += pageText + "\n\n";
    pageNumbers.push(i);
  }

  return {
    text: fullText,
    metadata: {
      pageCount: pdf.numPages,
      pageNumbers,
    },
  };
}

/**
 * Get a human-readable file type label.
 */
export function getFileTypeLabel(fileType: string): string {
  const labels: Record<string, string> = {
    pdf: "PDF",
    md: "Markdown",
    txt: "Text",
    json: "JSON",
    csv: "CSV",
    log: "Log",
  };
  return labels[fileType] ?? fileType.toUpperCase();
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
