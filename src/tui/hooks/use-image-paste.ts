/**
 * Hook to stage images for sending alongside a chat message.
 *
 * Two detection paths:
 * 1. Binary paste — terminals that send raw image bytes (Kitty, etc.)
 * 2. Ctrl+V keyboard — reads the system clipboard via native commands
 *    (osascript on macOS, xclip/wl-paste on Linux). This is the primary
 *    path because most terminals intercept Cmd+V themselves and never
 *    send image data to the running application.
 */

import { useState, useCallback, useRef } from "react";
import { usePaste, useKeyboard } from "@opentui/react";
import { readClipboardImage } from "../clipboard-image.ts";

export interface PendingImage {
  data: string;
  media_type: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function useImagePaste() {
  const [images, setImages] = useState<PendingImage[]>([]);
  const reading = useRef(false);

  // Path 1: Binary paste from terminal (rare but covers Kitty etc.)
  usePaste((event) => {
    const mime = event.metadata?.mimeType;
    const kind = event.metadata?.kind;
    const detected = mime?.startsWith("image/") ? mime : (kind === "binary" ? detectMime(event.bytes) : null);
    if (!detected || event.bytes.length > MAX_IMAGE_BYTES) return;
    event.preventDefault();
    setImages((prev) => [...prev, { data: uint8ToBase64(event.bytes), media_type: detected }]);
  });

  // Path 2: Ctrl+V or Cmd+V → read system clipboard for image data.
  useKeyboard((key) => {
    const isPasteKey = key.name === "v" && (key.ctrl || (key as { super?: boolean }).super);
    if (!isPasteKey || key.shift || reading.current) return;
    reading.current = true;
    readClipboardImage()
      .then((img) => { if (img) setImages((prev) => [...prev, img]); })
      .finally(() => { reading.current = false; });
  });

  const clear = useCallback(() => setImages([]), []);
  const remove = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  return { images, clear, remove } as const;
}

function uint8ToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  const [b0, b1, b2, b3] = bytes;
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return "image/png";
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return "image/jpeg";
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return "image/gif";
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && bytes.length > 11
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}
