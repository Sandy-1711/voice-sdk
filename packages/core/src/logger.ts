/**
 * Lives on its own so both the transport middleware and the `Voice` wrapper can
 * take one without importing each other.
 */
export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
