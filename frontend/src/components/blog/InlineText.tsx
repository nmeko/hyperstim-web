import Markdown from "react-markdown";

// A short text from a post's front matter (the TL;DR), with markdown's **bold**, *italic* and
// ***both***, in the text's own color, and nothing else (plan 018): other markdown shows as the
// text it contains.

export default function InlineText({ children }: { children: string }) {
  return (
    <Markdown
      allowedElements={["strong", "em"]}
      unwrapDisallowed
      components={{ strong: ({ children }) => <strong className="font-bold">{children}</strong> }}
    >
      {children}
    </Markdown>
  );
}
