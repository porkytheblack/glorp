import type { Ref } from "react";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { theme } from "../../theme.ts";
import { SlashMenu, type SlashCommand } from "../slash-menu.tsx";

interface VariantProps {
  width: number;
  busy: boolean;
  modelLabel?: string;
  activeQuery: string;
  menuIndex: number;
  slashCommands: SlashCommand[];
  skillHints: SlashCommand[];
  subagentMentions: SlashCommand[];
  textareaProps: {
    instanceKey: number;
    setRef: Ref<TextareaRenderable | null>;
    initialValue: string;
    onContentChange: () => void;
    onCursorChange: () => void;
    onSubmit: () => void;
    onKeyDown: (key: KeyEvent) => void;
    keyBindings: unknown;
    placeholder: string;
    minLines: number;
    maxLines: number;
  };
}

function TextareaSlot({ t, busy }: { t: VariantProps["textareaProps"]; busy: boolean }) {
  return (
    <textarea
      key={t.instanceKey}
      ref={t.setRef as any}
      initialValue={t.initialValue}
      onContentChange={t.onContentChange}
      onCursorChange={t.onCursorChange}
      onSubmit={t.onSubmit}
      focused
      minHeight={t.minLines}
      maxHeight={t.maxLines}
      onKeyDown={t.onKeyDown}
      wrapMode="word"
      keyBindings={t.keyBindings as any}
      placeholder={t.placeholder}
      textColor={theme.text}
      placeholderColor={busy ? theme.warning : theme.textDim}
      backgroundColor="transparent"
      focusedBackgroundColor="transparent"
    />
  );
}

export function HeroVariant(props: VariantProps) {
  const { width, busy, modelLabel, activeQuery, menuIndex, slashCommands, skillHints, subagentMentions, textareaProps } = props;
  const accent = busy ? theme.warning : theme.accentSoft;
  return (
    <box flexDirection="column" width={width}>
      <SlashMenu query={activeQuery} selectedIndex={menuIndex} width={width}
        slashCommands={slashCommands} skillHints={skillHints} subagentMentions={subagentMentions} />
      <box flexDirection="row" border borderStyle="rounded" borderColor={accent} padding={0} width={width} alignItems="stretch">
        <box width={1} backgroundColor={accent} />
        <box flexDirection="column" flexGrow={1} paddingX={1} paddingY={0}>
          <box minHeight={textareaProps.minLines} maxHeight={textareaProps.maxLines} flexDirection="row">
            <TextareaSlot t={textareaProps} busy={busy} />
          </box>
          <box marginTop={1} flexDirection="row">
            <text fg={theme.accentSoft}><strong>Build</strong></text>
            <text fg={theme.textDim}> · </text>
            <text fg={theme.textMuted}>{modelLabel ?? "no model"}</text>
          </box>
        </box>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingX={1} marginTop={1}>
        <text fg={theme.textDim}>
          <span fg={theme.text}>tab</span> hints · <span fg={theme.text}>ctrl+m</span> models ·{" "}
          <span fg={theme.text}>ctrl+p</span> commands
        </text>
      </box>
    </box>
  );
}

export function DefaultVariant(props: VariantProps) {
  const { width, busy, modelLabel, activeQuery, menuIndex, slashCommands, skillHints, subagentMentions, textareaProps } = props;
  const borderColor = busy ? theme.warning : theme.borderActive;
  const promptGlyph = busy ? "…" : "›";
  return (
    <box flexDirection="column" width={width}>
      <SlashMenu query={activeQuery} selectedIndex={menuIndex} width={width}
        slashCommands={slashCommands} skillHints={skillHints} subagentMentions={subagentMentions} />
      <box flexDirection="row" border borderStyle="rounded" borderColor={borderColor} padding={0} width={width} alignItems="stretch">
        <box width={1} backgroundColor={busy ? theme.warning : theme.accentSoft} />
        <box flexDirection="row" flexGrow={1} paddingX={1} alignItems="flex-start" minHeight={textareaProps.minLines}>
          <text fg={busy ? theme.warning : theme.accent}><strong>{promptGlyph}</strong></text>
          <text> </text>
          <box flexGrow={1} minHeight={textareaProps.minLines} maxHeight={textareaProps.maxLines}>
            <TextareaSlot t={textareaProps} busy={busy} />
          </box>
        </box>
      </box>
      <box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <text fg={theme.textDim}>
          {busy ? "ctrl-c interrupts · submissions blocked until done" : modelLabel ?? ""}
        </text>
        <text fg={theme.textDim}>
          <span fg={theme.text}>tab</span> hints · <span fg={theme.text}>ctrl+m</span> models ·{" "}
          <span fg={theme.text}>ctrl+p</span> commands
        </text>
      </box>
    </box>
  );
}
