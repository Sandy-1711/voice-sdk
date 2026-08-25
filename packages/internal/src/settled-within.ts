/**
 * True if `promise` settled before `ms` elapsed, false if the deadline won.
 *
 * The timer is unrefed so waiting on a socket that will never answer is not the
 * reason a process refuses to exit.
 */
export function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        timer.unref?.();

        const settled = () => {
            clearTimeout(timer);
            resolve(true);
        };
        promise.then(settled, settled);
    });
}
