import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Model output and recovered archives are untrusted text. A rendered response must not
// be able to load a remote resource (tracking pixels, beacons), steer navigation, or
// execute markup, so images become their alt text and links become plain text.
const components = {
  img({ alt }: { alt?: string }) {
    return <span className="text-sura-muted">{alt ?? ""}</span>;
  },
  a({ children }: { children?: React.ReactNode }) {
    return <span>{children}</span>;
  },
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none [&_code]:dir-ltr [&_code]:font-mono [&_pre]:dir-ltr [&_pre]:text-left [&_table]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{text}</ReactMarkdown>
    </div>
  );
}
