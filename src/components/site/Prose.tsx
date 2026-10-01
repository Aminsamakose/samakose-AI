import ReactMarkdown from 'react-markdown';

/** Renders trusted repository Markdown with the site's typography. Raw HTML in Markdown is not rendered. */
export function Prose({ children }: { children: string }) {
  return (
    <div className="max-w-none text-[1.05rem] leading-relaxed text-fg">
      <ReactMarkdown components={{
        h2: (p) => <h2 className="mb-3 mt-10 font-display text-2xl font-bold tracking-tight" {...p} />,
        h3: (p) => <h3 className="mb-2 mt-6 font-display text-xl font-semibold" {...p} />,
        p: (p) => <p className="mt-4 text-fg/90" {...p} />,
        ul: (p) => <ul className="mt-4 flex list-disc flex-col gap-2 pl-6" {...p} />,
        ol: (p) => <ol className="mt-4 flex list-decimal flex-col gap-2 pl-6" {...p} />,
        strong: (p) => <strong className="font-semibold text-fg" {...p} />,
        a: (p) => <a className="font-semibold text-leaf underline underline-offset-2" {...p} />
      }}>{children}</ReactMarkdown>
    </div>
  );
}
