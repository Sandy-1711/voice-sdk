import type WebSocket from "ws";

/**
 * `ws` hands back Buffer, Buffer[] or ArrayBuffer depending on the frame, and
 * only Buffer has a toString() that decodes rather than returning
 * "[object ArrayBuffer]".
 */
export function toText(raw: WebSocket.RawData): string {
    if (Array.isArray(raw)) return Buffer.concat(raw).toString();
    if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
    return raw.toString();
}
