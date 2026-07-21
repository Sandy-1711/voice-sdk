import { VoiceError } from "@voice-sdk/core";
import type { ResolvedConfig } from "../config";

/** Auth headers for ElevenLabs REST calls (BYOK). */
export function authHeaders(config: ResolvedConfig): Record<string, string> {
  return { "xi-api-key": config.apiKey };
}

/** Throw a descriptive {@link VoiceError} on a non-2xx response. */
export async function ensureOk(res: Response, action: string): Promise<Response> {
  if (res.ok) return res;
  const detail = await res.text().catch(() => "");
  throw new VoiceError(
    `ElevenLabs ${action} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
  );
}
