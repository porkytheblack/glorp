"use client";

import * as React from "react";
import { CircleStop, ImagePlus, SendHorizontal, X } from "lucide-react";
import { Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { SlashMenu, type SlashCommand } from "./slash-menu";

/** Message composer: auto-growing textarea, Enter to send, Stop while busy.
 *  Typing "/" surfaces the agent's commands (hooks + skills) inline. */
export function Composer({
  busy,
  disabled,
  onSend,
  onStop,
  controls,
  commands = [],
  imageSupport,
}: {
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string, images?: Array<{ data: string; media_type: string }>) => void;
  onStop: () => void;
  controls?: React.ReactNode;
  commands?: SlashCommand[];
  /** false = the current model cannot see images (attach disabled); null/undefined = unknown (allowed). */
  imageSupport?: boolean | null;
}) {
  const [text, setText] = React.useState("");
  const [caret, setCaret] = React.useState(0);
  const [slashIdx, setSlashIdx] = React.useState(0);
  const [slashDismissed, setSlashDismissed] = React.useState(false);
  const [images, setImages] = React.useState<Array<{ data: string; media_type: string; preview: string }>>([]);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const addImageFiles = React.useCallback((files: Iterable<File>) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        const data = url.slice(url.indexOf(",") + 1); // strip the data: prefix
        setImages((prev) => (prev.length >= 6 ? prev : [...prev, { data, media_type: file.type, preview: url }]));
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // The menu engages while the caret sits in a "/token" — anywhere in the
  // message, as long as the slash follows start-of-text or whitespace
  // (mirrors glove's own directive parser).
  const beforeCaret = text.slice(0, caret);
  const slashMatch = /(^|\s)\/([a-z0-9_-]*)$/i.exec(beforeCaret);
  const slashQuery = slashMatch?.[2] ?? null;
  const tokenStart = slashMatch ? beforeCaret.length - slashMatch[2]!.length - 1 : -1;
  const slashMatches =
    slashQuery !== null && !slashDismissed
      ? commands.filter((c) => c.name.slice(1).toLowerCase().startsWith(slashQuery.toLowerCase())).slice(0, 8)
      : [];
  const slashOpen = slashMatches.length > 0;

  const pickSlash = (cmd: SlashCommand) => {
    const next = `${text.slice(0, tokenStart)}${cmd.name} ${text.slice(caret)}`;
    const newCaret = tokenStart + cmd.name.length + 1;
    setText(next);
    setSlashIdx(0);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newCaret, newCaret);
      setCaret(newCaret);
    });
  };

  const grow = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  React.useEffect(grow, [text, grow]);

  const submit = () => {
    if ((!text.trim() && images.length === 0) || disabled) return;
    onSend(text, images.length ? images.map(({ data, media_type }) => ({ data, media_type })) : undefined);
    setText("");
    setImages([]);
  };

  return (
    <div className="border-t border-border bg-background px-4 py-3.5 md:px-6">
      <div className="group relative mx-auto w-full max-w-3xl rounded-xl border border-border bg-card p-2.5 shadow-card transition-shadow focus-within:border-brand/40 focus-within:shadow-glow">
        {slashOpen && <SlashMenu commands={slashMatches} activeIndex={slashIdx} onPick={pickSlash} />}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pb-1 pt-1.5">
            {images.map((img, i) => (
              <span key={i} className="group/img relative overflow-hidden rounded-md border border-border shadow-sheen">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.preview} alt="attachment" className="size-14 object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/img:opacity-100"
                  title="Remove image"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? "Session offline…" : "Message Glorp…"}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setSlashDismissed(false);
            setSlashIdx(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onPaste={(e) => {
            const files = [...e.clipboardData.items].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter((f): f is File => Boolean(f));
            if (files.length) {
              e.preventDefault();
              if (imageSupport === false) return; // text-only model — ignore the paste
              addImageFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (slashOpen) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => (i + 1) % slashMatches.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
              if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); pickSlash(slashMatches[slashIdx] ?? slashMatches[0]!); return; }
              if (e.key === "Escape") { e.preventDefault(); setSlashDismissed(true); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-[200px] min-h-[24px] w-full resize-none bg-transparent px-2.5 py-1.5 text-[13.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
          <div className="flex min-w-0 items-center gap-1">
            {controls}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || imageSupport === false}
              className="grid size-8 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
              title={imageSupport === false ? "The current model can't see images" : "Attach image (or paste one)"}
            >
              <ImagePlus className="size-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addImageFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {busy ? (
              <>
                <span className="text-[11.5px] font-medium text-warning">Working…</span>
                <Button size="sm" variant="secondary" onClick={onStop} title="Stop the agent">
                  <CircleStop /> Stop
                </Button>
              </>
            ) : (
              <>
                <span className="hidden text-[11px] text-faint sm:inline">
                  <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px]">↵</kbd> send
                  <span className="mx-1 text-faint/60">·</span>
                  <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px]">⇧↵</kbd> newline
                </span>
                <Button size="sm" onClick={submit} disabled={(!text.trim() && images.length === 0) || disabled} title="Send">
                  {disabled ? <Spinner /> : <SendHorizontal />} Send
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
