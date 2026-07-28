export function decodeBase64(data: string): Uint8Array {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(data, "base64"));

    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
