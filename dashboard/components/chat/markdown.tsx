import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Theme-aware markdown for assistant messages (styles live in globals.css `.md`). */
export function Md({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md text-[13.5px] leading-relaxed text-foreground/90", className)}>
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}
