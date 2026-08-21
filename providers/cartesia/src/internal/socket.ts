import WebSocket from "ws";
import { VoiceError } from "@swungstudent/voice";
import { authHeaders } from "./http";

/**
 * Cartesia's sockets are plain `ws` connections that differ only in their URL
 * and their params, so all three share the open + send-when-ready plumbing.
 *
 * Auth rides in the handshake headers, the same pair the HTTP calls send. The
 * `api_key` query parameter Cartesia also accepts is for browsers, which cannot
 * set headers — putting a key in a URL leaves it in logs and proxies.
 */
export function open(url: URL, apiKey: string): WebSocket {
    const address = new URL(url);
    address.protocol = address.protocol === "https:" ? "wss:" : "ws:";

    return new WebSocket(address, { headers: authHeaders(apiKey) });
}

/**
 * A session only exists once its handshake resolved, so a socket that is not
 * open here is one that has since closed. Dropping the frame is the right move:
 * `push` is fire-and-forget, and throwing from it would surface the failure
 * somewhere the caller cannot catch it. The close itself reaches them through
 * `closed` and the output stream.
 */
export function sendIfOpen(ws: WebSocket, payload: string | Uint8Array): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
}

/**
 * Resolves once the socket is usable, rejects if it never gets there. Waiting
 * for the handshake is what makes a bad key or model throw from `open()` rather
 * than silently ending the caller's `for await` later.
 */
export function handshake(ws: WebSocket, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const onOpen = () => {
            ws.off("error", onError);
            resolve();
        };
        const onError = (error: Error) => {
            ws.off("open", onOpen);
            reject(new VoiceError(`Cartesia ${label} socket failed to open: ${String(error)}`));
        };

        ws.once("open", onOpen);
        ws.once("error", onError);
    });
}

/** `ws` hands back Buffer, Buffer[] or ArrayBuffer depending on the frame. */
export function toBytes(raw: WebSocket.RawData): Uint8Array {
    if (Array.isArray(raw)) return Buffer.concat(raw);
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

/** Via toBytes, since `ArrayBuffer.toString()` yields "[object ArrayBuffer]". */
export function toText(raw: WebSocket.RawData): string {
    return new TextDecoder().decode(toBytes(raw));
}
