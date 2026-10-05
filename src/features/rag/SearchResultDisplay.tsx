import { Badge } from "@/components/ui/badge";

export interface SearchResult {
  chunkId: string;
  text: string;
  score: number;
  source: string;
  documentId: string;
}

interface SearchResultDisplayProps {
  results: SearchResult[];
  onViewSource?: (documentId: string) => void;
}

/**
 * Display search results in the chat interface.
 * Shows the source file and relevance score for each result.
 */
export function SearchResultDisplay({ results, onViewSource }: SearchResultDisplayProps) {
  if (results.length === 0) return null;

  return (
    <div className="space-y-2 p-2 bg-sura-panel rounded border border-sura-border text-xs" dir="rtl">
      <p className="text-sura-muted font-medium">نتائج البحث في المستندات:</p>
      <div className="space-y-1">
        {results.map((result) => (
          <div
            key={result.chunkId}
            className="flex items-start gap-2 p-1.5 rounded bg-sura-bg/50"
          >
            <div className="flex-1 min-w-0">
              <p className="truncate text-sura-muted">
                <Badge variant="secondary" className="ml-1">
                  {result.source}
                </Badge>
                <span className="text-[10px]">
                  {Math.round(result.score * 100)}%
                </span>
              </p>
              <p className="truncate mt-0.5">{result.text.slice(0, 100)}…</p>
            </div>
            {onViewSource && (
              <button
                className="text-sura-muted hover:text-sura-accent shrink-0"
                onClick={() => onViewSource(result.documentId)}
              >
                عرض
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact search result indicator for inline display.
 */
export function SearchResultIndicator({ count }: { count: number }) {
  if (count === 0) return null;
  
  return (
    <Badge variant="outline" className="text-[10px]">
      {count} نتيجة بحث
    </Badge>
  );
}
