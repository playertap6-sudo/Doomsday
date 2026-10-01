import katex from "katex";
import { useMemo } from "react";

export function Katex({
  expr,
  display = false,
  className,
}: {
  expr: string;
  display?: boolean;
  className?: string;
}) {
  const html = useMemo(
    () =>
      katex.renderToString(expr, {
        displayMode: display,
        throwOnError: false,
        output: "html",
      }),
    [expr, display],
  );
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
