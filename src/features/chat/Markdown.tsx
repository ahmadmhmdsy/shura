import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none [&_code]:dir-ltr [&_code]:font-mono [&_pre]:dir-ltr [&_pre]:text-left [&_table]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
