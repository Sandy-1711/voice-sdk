interface Closable {
    close(): Promise<void>;
}

/**
 * Closes `session` when `signal` aborts. Call it before awaiting a handshake,
 * so an abort mid-handshake still closes the socket.
 *
 * A listener never fires for an already-aborted signal, hence the pre-check;
 * nobody awaits this close and an unhandled rejection is fatal, hence the catch.
 */
export function closeOnAbort(session: Closable, signal: AbortSignal | undefined): void {
    if (!signal) return;

    const close = () => void session.close().catch(() => {});
    if (signal.aborted) {
        close();
        return;
    }
    signal.addEventListener("abort", close, { once: true });
}
