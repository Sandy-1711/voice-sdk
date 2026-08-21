// Deterministic audio, so assertions can be about bytes rather than sound.

/** `samples` samples of s16le silence. */
export function pcmSilence(samples: number): Uint8Array {
    return new Uint8Array(samples * 2);
}

/** A recognisable s16le ramp, so a truncated buffer is obvious in a diff. */
export function pcmRamp(samples: number): Uint8Array {
    const bytes = new Uint8Array(samples * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples; i += 1) view.setInt16(i * 2, (i * 257) % 32768, true);
    return bytes;
}

/** Wraps raw s16le samples in a RIFF header, for the container-aware paths. */
export function wav(pcm: Uint8Array, sampleRate = 16000, channels = 1): Uint8Array {
    const bytes = new Uint8Array(44 + pcm.length);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };

    ascii(0, "RIFF");
    view.setUint32(4, 36 + pcm.length, true);
    ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, pcm.length, true);
    bytes.set(pcm, 44);

    return bytes;
}

export function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values);
}

/** Drains an async iterable, with a deadline so a stuck stream fails loudly. */
export async function collect<T>(source: AsyncIterable<T>, timeout = 5000): Promise<T[]> {
    const items: T[] = [];
    const iterator = source[Symbol.asyncIterator]();
    const deadline = Date.now() + timeout;

    for (;;) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`collect() timed out after ${items.length} items.`);

        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`collect() timed out after ${items.length} items.`)),
                    left,
                );
            }),
        ]).finally(() => clearTimeout(timer));

        if (result.done) return items;
        items.push(result.value);
    }
}

/** Polls until `predicate` holds, for state a provider updates off-thread. */
export async function waitFor(predicate: () => boolean, timeout = 2000, label = "condition"): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
