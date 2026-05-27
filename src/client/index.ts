/**
 * Glorp client SDK -- public API surface.
 */

export {
  GlorpClient,
  type GlorpClientConfig,
  type ClientState,
  type ClientListener,
} from "./client.ts";

export { discoverServer, serverUrl } from "./discovery.ts";

export { serverMessageToBridgeEvent } from "./bridge-adapter.ts";
