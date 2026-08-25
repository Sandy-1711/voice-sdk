import type WebSocket from "ws";
import { settledWithin } from "@voice-sdk/internal";

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

/** Long enough for a real goodbye round-trip, short enough not to strand a shutdown. */
const CLOSE_TIMEOUT_MS = 5000;

/**
 * Waits for the far side to close the socket, then stops waiting and drops it.
 *
 * A server that takes the goodbye and never closes would otherwise leave
 * close() pending forever, and with it every caller awaiting the session.
 */
export async function awaitClose(ws: WebSocket, closed: Promise<void>): Promise<void> {
    if (!(await settledWithin(closed, CLOSE_TIMEOUT_MS))) ws.terminate();
    await closed;
}
