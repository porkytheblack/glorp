
describe("capUserImages (pasted screenshots must not haunt every request)", () => {
  const { capUserImages } = require("../src/agent/runtime/image-tool-results.ts");
  const imgMsg = (id: string) => ({
    sender: "user",
    text: "",
    content: [
      { type: "text", text: `msg ${id}` },
      { type: "image", source: { type: "base64", media_type: "image/png", data: `payload_${id}` } },
    ],
  });

  test("keeps the most recent two user images, replaces older with a marker", () => {
    const messages = [imgMsg("a"), { sender: "agent", text: "ok" }, imgMsg("b"), imgMsg("c")] as never[];
    const out = capUserImages(messages);
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("payload_a");
    expect(flat).toContain("payload_b");
    expect(flat).toContain("payload_c");
    expect(flat).toContain("image omitted to conserve context");
    // stored history untouched — the function returns a copy
    expect(JSON.stringify(messages)).toContain("payload_a");
  });

  test("no-op (same reference) at or under the cap", () => {
    const messages = [imgMsg("a"), imgMsg("b")] as never[];
    expect(capUserImages(messages)).toBe(messages);
  });
});
