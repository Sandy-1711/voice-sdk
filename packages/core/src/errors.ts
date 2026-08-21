export class VoiceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VoiceError";
    }
}

export class CapabilityError extends VoiceError {
    constructor(
        public readonly provider: string,
        public readonly capability: string,
    ) {
        super(`Provider "${provider}" does not support "${capability}".`);
        this.name = "CapabilityError";
    }
}

export class ConfigError extends VoiceError {
    constructor(
        public readonly provider: string,
        public readonly field: string,
        message: string,
    ) {
        super(`Provider "${provider}" configuration error for field "${field}": ${message}`);
        this.name = "ConfigError";
    }
}

/**
 * A request field carried a value this provider cannot represent. Thrown before
 * the request goes out, so the caller sees the offending field rather than a
 * bare 400 from the API.
 */
export class ValidationError extends VoiceError {
    constructor(
        public readonly provider: string,
        public readonly field: string,
        message: string,
    ) {
        super(`Provider "${provider}" rejected "${field}": ${message}`);
        this.name = "ValidationError";
    }
}
