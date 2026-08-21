import { WebSocket } from "ws";

/**
 * Gives `@cartesia/cartesia-js` a global WebSocket to find on Node 18 and 20.
 *
 * Its ESM build opens with `require('ws')` inside a try/catch. `require` does
 * not exist in an ES module, so that call always throws, is swallowed, and the
 * SDK falls through to `globalThis.WebSocket`. Node 22 has one and Node 18 and
 * 20 do not, so realtime sessions there fail with "requires the ws package but
 * it could not be loaded" — despite `ws` being a direct dependency.
 *
 * Assigning the global puts older Node on the same path Node 22 already takes,
 * rather than introducing a third behaviour: the SDK reaches its browser
 * branch either way, since its own `_ws` stays undefined. `??=` means a real
 * global, or a caller's own polyfill, always wins.
 *
 * Goes away with the SDK.
 */
export function ensureWebSocket(): void {
    globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;
}
