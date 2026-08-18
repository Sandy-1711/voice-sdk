import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Core sits at the root of the dependency graph, so its tests carry their own
 * two helpers rather than reaching for @voice-sdk/test-kit - which depends on
 * core, and would make the graph circular.
 */

export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of source) items.push(item);
    return items;
}

export interface ByteServer {
    url: string;
    close(): Promise<void>;
}

/** Serves one fixed body, for the `{ url }` audio source. */
export async function serveBytes(body: Uint8Array, path = "/audio.pcm"): Promise<ByteServer> {
    const server: Server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(Buffer.from(body));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${port}${path}`,
        close() {
            return new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => (error ? reject(error) : resolve()));
            });
        },
    };
}

/** A recognisable s16le ramp, so a truncated buffer is obvious in a diff. */
export function pcmRamp(samples: number): Uint8Array {
    const bytes = new Uint8Array(samples * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples; i += 1) view.setInt16(i * 2, (i * 257) % 32768, true);
    return bytes;
}
