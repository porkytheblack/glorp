import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";

interface Props {
  children: React.ReactNode;
  width?: number;
  height?: number;
}

/**
 * Renders an overlay as a layer OVER the main content. The main content stays
 * rendered but dimmed beneath. The overlay children are centered in the viewport.
 *
 * In OpenTUI, we achieve the "dim" effect by rendering a full-viewport box
 * with the dim background, then centering the overlay content within it.
 * The parent must still render the main layout — this component layers on top.
 */
export function OverlayHost({ children, width: forcedW, height: forcedH }: Props) {
  const { width: termW, height: termH } = useTerminalDimensions();
  const w = forcedW ?? termW;
  const h = forcedH ?? termH;

  return (
    <box
      flexDirection="column"
      width={w}
      height={h}
      backgroundColor={theme.dimOverlay}
      justifyContent="center"
      alignItems="center"
    >
      {children}
    </box>
  );
}

/**
 * Standard overlay panel with rounded border and consistent padding, styled
 * like the Helix command palette: a clean title bar (title left, optional
 * subtitle right) and a dim footer hint row at the bottom.
 *
 * Backward compatible — existing callers pass
 * `{ title, titleColor?, hint?, children, borderColor?, width }`. The legacy
 * `hint` renders as the footer. New optional props: `subtitle`, `footer`.
 */
export function OverlayPanel({
  title,
  titleColor,
  subtitle,
  hint,
  footer,
  children,
  borderColor,
  width,
}: {
  title: string;
  titleColor?: string;
  subtitle?: string;
  hint?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  borderColor?: string;
  width: number;
}) {
  const accent = titleColor ?? theme.accent;
  const footerContent = footer ?? (hint ? <text fg={theme.footer}>{hint}</text> : null);

  return (
    <box
      flexDirection="column"
      width={width}
      border
      borderStyle="rounded"
      borderColor={borderColor ?? theme.borderActive}
      backgroundColor={theme.bgPanel}
      padding={1}
    >
      <box flexDirection="row" width={width - 4}>
        <text fg={accent}><strong>{title}</strong></text>
        <box flexGrow={1} />
        {subtitle && <text fg={theme.textMuted}>{subtitle}</text>}
      </box>
      {children}
      {footerContent && <box marginTop={1}>{footerContent}</box>}
    </box>
  );
}
