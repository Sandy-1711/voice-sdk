export class VoiceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VoiceError";
    }
}

export class CapabilityError extends VoiceError {
    constructor(public readonly provider: string, public readonly capability: string) {
        super(`Provider "${provider}" does not support "${capability}".`);
        this.name = "CapabilityError";
    }
}
