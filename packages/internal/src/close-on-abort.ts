interface Closable {
    close(): Promise<void>;
}

/**
 * Closes `session` when `signal` aborts. Call it before awaiting a handshake,
 * so an abort mid-handshake still closes the socket.
 *
 * An already-aborted signal is the caller's `throwIfAborted()` to catch, not
 * this one's — opening a socket only to close it reports the abort as a
 * handshake failure. The `catch` is load-bearing: nobody awaits this close, and
 * an unhandled rejection is fatal on current node.
 */
export function closeOnAbort(session: Closable, signal: AbortSignal | undefined): void {
    signal?.addEventListener("abort", () => void session.close().catch(() => {}), { once: true });
}
