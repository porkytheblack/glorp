import React from "react";

export interface GlorpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focused?: boolean;
  textColor?: string;
  placeholderColor?: string;
  cursorColor?: string;
}

/**
 * Tiny wrapper around OpenTUI's `<input>` element. Same trick we use in
 * input-bar.tsx — going through `React.createElement` dodges the JSX
 * intersection between OpenTUI's `<input>` and React DOM's `<input>`.
 */
export function GlorpInput(props: GlorpInputProps): React.ReactElement {
  return React.createElement(
    "input",
    props as unknown as React.InputHTMLAttributes<HTMLInputElement>,
  );
}
