import { registerSlotRenderer } from "./registry.tsx";
import { PermissionSlot } from "./permission.tsx";
import { ConfirmSlot } from "./confirm.tsx";
import { InfoSlot } from "./info.tsx";
import { SelectOneSlot } from "./select-one.tsx";
import { TextInputSlot } from "./text-input.tsx";

/**
 * Built-in slot renderers. Importing this module registers all of them
 * with the registry. Consumers (additional tools, plugins) can register
 * more via `registerSlotRenderer(name, component)`.
 */
registerSlotRenderer("permission_request", PermissionSlot);
registerSlotRenderer("confirm", ConfirmSlot);
registerSlotRenderer("info", InfoSlot);
registerSlotRenderer("select_one", SelectOneSlot);
registerSlotRenderer("text_input", TextInputSlot);

export { registerSlotRenderer, getSlotRenderer, SLOT_RENDERERS } from "./registry.tsx";
export type { SlotRenderer, SlotRendererProps } from "./registry.tsx";
export { UnknownSlot } from "./unknown.tsx";
