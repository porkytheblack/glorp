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
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
    >
      {children}
    </box>
  );
}

/**
 * Standard overlay panel with rounded border and consistent padding.
 * Used by all overlay screens (model switcher, session picker, help, etc.)
 */
export function OverlayPanel({
  title,
  titleColor,
  hint,
  children,
  borderColor,
  width,
}: {
  title: string;
  titleColor?: string;
  hint?: string;
  children: React.ReactNode;
  borderColor?: string;
  width: number;
}) {
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
      <text fg={titleColor ?? theme.accent}><strong>{title}</strong></text>
      {hint && <text fg={theme.textDim}>{hint}</text>}
      {children}
    </box>
  );
}
