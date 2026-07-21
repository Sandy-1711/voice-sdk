import { CapKey } from "./provider";
export class VoiceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VoiceError";
    }
}

export class CapabilityError extends VoiceError {
    constructor(public readonly provider: string, public readonly capability: CapKey) {
        super(`Provider "${provider}" does not support "${capability}".`);
        this.name = "CapabilityError";
    }
}
