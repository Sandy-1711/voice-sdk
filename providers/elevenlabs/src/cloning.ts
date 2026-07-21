import type { VoiceCloning, ClonedVoice, CloneVoiceInput } from "@voice-sdk/core";
import type { ResolvedConfig } from "./config";
import { authHeaders, ensureOk } from "./internal/http";
import { collectAudio } from "./internal/collect";

interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string; // "cloned" | "premade" | ...
}
interface ElevenVoicesList {
  voices: ElevenVoice[];
}
interface ElevenAddVoice {
  voice_id: string;
}

export class ElevenLabsCloning implements VoiceCloning {
  #config: ResolvedConfig;

  constructor(config: ResolvedConfig) {
    this.#config = config;
  }

  async clone(input: CloneVoiceInput): Promise<ClonedVoice> {
    const form = new FormData();
    form.append("name", input.name);
    if (input.description) form.append("description", input.description);
    if (input.labels) form.append("labels", JSON.stringify(input.labels));

    let i = 0;
    for (const sample of input.samples) {
      const bytes = await collectAudio(sample);
      form.append("files", new Blob([new Uint8Array(bytes)]), `sample_${i++}`);
    }

    const url = new URL("/v1/voices/add", this.#config.baseUrl);
    const res = await ensureOk(
      await fetch(url, {
        method: "POST",
        headers: authHeaders(this.#config),
        body: form,
      }),
      "voice clone",
    );
    const data = (await res.json()) as ElevenAddVoice;
    return { id: data.voice_id, name: input.name, cloned: true };
  }

  async list(): Promise<ClonedVoice[]> {
    const url = new URL("/v1/voices", this.#config.baseUrl);
    const res = await ensureOk(
      await fetch(url, { headers: authHeaders(this.#config) }),
      "list voices",
    );
    const data = (await res.json()) as ElevenVoicesList;
    return data.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      cloned: v.category === "cloned",
    }));
  }

  async delete(voiceId: string): Promise<void> {
    const url = new URL(`/v1/voices/${voiceId}`, this.#config.baseUrl);
    await ensureOk(
      await fetch(url, { method: "DELETE", headers: authHeaders(this.#config) }),
      "delete voice",
    );
  }
}
