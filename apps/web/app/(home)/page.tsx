import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { CopyCommand } from "@/components/copy-command";
import {
  PROVIDER_SAMPLES,
  REALTIME_STT,
  REALTIME_TTS,
  RESOLVED_FORMAT,
  VALIDATION,
} from "@/components/landing/samples";
import { GITHUB_URL, NPM_URL } from "@/lib/layout.shared";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <ProviderSwap />
      <Capabilities />
      <Realtime />
      <Formats />
      <Errors />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section className="border-b border-fd-border px-6 py-24 text-center sm:py-32">
      <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
        Speak. Listen. Switch providers.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-fd-muted-foreground text-balance">
        An open-source TypeScript SDK for voice. Synthesis and transcription, batch and realtime, with the
        same types whichever provider is behind them — so switching is a constructor change rather than a
        rewrite.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <CopyCommand command="pnpm add @swungstudent/voice @swungstudent/deepgram" />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm">
        <Link
          href="/docs/quickstart"
          className="inline-flex items-center gap-1.5 rounded-lg bg-fd-primary px-4 py-2.5 font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
        >
          Quickstart
          <ArrowRight className="size-4" />
        </Link>
        <Link
          href="/docs"
          className="rounded-lg border border-fd-border px-4 py-2.5 font-medium transition-colors hover:bg-fd-accent"
        >
          Documentation
        </Link>
        <a
          href={GITHUB_URL}
          className="rounded-lg border border-fd-border px-4 py-2.5 font-medium transition-colors hover:bg-fd-accent"
        >
          GitHub
        </a>
      </div>
    </section>
  );
}

function ProviderSwap() {
  return (
    <Section
      title="Write one call. Run it on any provider."
      lead="The constructor names a provider. Nothing below it changes — same input types, same
        result types, same errors."
    >
      <Tabs items={PROVIDER_SAMPLES.map((sample) => sample.name)}>
        {PROVIDER_SAMPLES.map((sample) => (
          <Tab key={sample.id} value={sample.name}>
            <DynamicCodeBlock lang="ts" code={sample.code} />
          </Tab>
        ))}
      </Tabs>
      <p className="mt-6 text-sm text-fd-muted-foreground">
        Providers declare core as a peer dependency, so an application never ends up with two copies of the
        types.{" "}
        <Link href="/docs/providers" className="text-fd-foreground underline underline-offset-4">
          Compare the three
        </Link>
        .
      </p>
    </Section>
  );
}

const CAPABILITIES = [
  { name: "tts", methods: "speak, speakStream", meaning: "Full text in, audio out — buffered or streamed" },
  { name: "stt", methods: "transcribe", meaning: "A complete recording in, a transcript out" },
  {
    name: "realtimeTTS",
    methods: "openTTSSession",
    meaning: "Push text as it is generated, audio streams back",
  },
  {
    name: "realtimeSTT",
    methods: "openSTTSession",
    meaning: "Push audio frames live, transcripts stream back",
  },
];

function Capabilities() {
  return (
    <Section
      title="Four capabilities. A provider has them or says so."
      lead="Calling one a provider lacks raises a CapabilityError naming the provider, rather than
        failing somewhere deeper in."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {CAPABILITIES.map((capability) => (
          <div key={capability.name} className="rounded-xl border border-fd-border bg-fd-card p-5">
            <p className="font-mono text-sm font-medium text-fd-primary">{capability.name}</p>
            <p className="mt-1 font-mono text-xs text-fd-muted-foreground">{capability.methods}</p>
            <p className="mt-3 text-sm text-fd-muted-foreground">{capability.meaning}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-fd-border">
        <table className="w-full text-sm">
          <thead className="bg-fd-muted/50 text-fd-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">tts</th>
              <th className="px-4 py-3 font-medium">stt</th>
              <th className="px-4 py-3 font-medium">realtimeTTS</th>
              <th className="px-4 py-3 font-medium">realtimeSTT</th>
              <th className="px-4 py-3 font-medium">listVoices</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: "Cartesia", voices: true },
              { name: "Deepgram", voices: false },
              { name: "ElevenLabs", voices: true },
            ].map((provider) => (
              <tr key={provider.name} className="border-t border-fd-border">
                <td className="px-4 py-3 font-medium">{provider.name}</td>
                <td className="px-4 py-3 text-center">✅</td>
                <td className="px-4 py-3 text-center">✅</td>
                <td className="px-4 py-3 text-center">✅</td>
                <td className="px-4 py-3 text-center">✅</td>
                <td className="px-4 py-3 text-center text-fd-muted-foreground">
                  {provider.voices ? "✅" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm text-fd-muted-foreground">
        Deepgram has no voice-listing endpoint because a voice <em>is</em> a model there, so the method is
        absent rather than faked.
      </p>
    </Section>
  );
}

function Realtime() {
  return (
    <Section
      title="Realtime, in the shape an LLM response has."
      lead="Streaming audio out of a one-shot call is not the same as a duplex session. A session
        takes text in a token at a time, which is what speaking an LLM response needs."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-medium text-fd-muted-foreground">Speaking</h3>
          <DynamicCodeBlock lang="ts" code={REALTIME_TTS} />
        </div>
        <div>
          <h3 className="mb-3 text-sm font-medium text-fd-muted-foreground">Listening</h3>
          <DynamicCodeBlock lang="ts" code={REALTIME_STT} />
        </div>
      </div>
      <p className="mt-6 text-sm text-fd-muted-foreground">
        Transcripts arrive with three levels of finality — <code>partial</code> is still being revised,{" "}
        <code>final</code> is stable within a turn that may continue, and <code>turn_end</code> means the
        speaker finished.{" "}
        <Link href="/docs/guides/realtime-stt" className="text-fd-foreground underline underline-offset-4">
          How turn detection works
        </Link>
        .
      </p>
    </Section>
  );
}

function Formats() {
  return (
    <Section
      title="The format you get back is the format you got."
      lead="Every field you can ask for is optional. Every field you are told about is not."
    >
      <DynamicCodeBlock lang="ts" code={RESOLVED_FORMAT} />
      <p className="mt-6 text-sm text-fd-muted-foreground">
        ElevenLabs fuses container, rate and bitrate into one token. Cartesia prefixes its codecs. Deepgram
        splits them across query parameters. You write one <code>AudioFormat</code> and get a fully resolved
        one back, so nothing downstream has to guess how to play the bytes.{" "}
        <Link href="/docs/guides/audio-formats" className="text-fd-foreground underline underline-offset-4">
          Audio formats
        </Link>
        .
      </p>
    </Section>
  );
}

function Errors() {
  return (
    <Section
      title="Typed failures, before the request goes out."
      lead="Format mapping is where providers differ most, and a bare 400 gives you nothing to act
        on. Being told which field — often with the values that would have worked — is the
        difference between a fix and an investigation."
    >
      <DynamicCodeBlock lang="ts" code={VALIDATION} />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { name: "CapabilityError", when: "The provider does not implement what you called" },
          { name: "ConfigError", when: "Built without something it needs, like an API key" },
          { name: "ValidationError", when: "A field this provider cannot represent" },
        ].map((error) => (
          <div key={error.name} className="rounded-xl border border-fd-border bg-fd-card p-4">
            <p className="font-mono text-xs font-medium">{error.name}</p>
            <p className="mt-2 text-sm text-fd-muted-foreground">{error.when}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-fd-muted-foreground">
        All of them extend <code>VoiceError</code>, so one <code>catch</code> covers the SDK.
      </p>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="px-6 py-12">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 text-sm text-fd-muted-foreground">
        <span className="font-mono">voice-sdk · MIT</span>
        <div className="flex flex-wrap gap-6">
          <Link href="/docs" className="hover:text-fd-foreground">
            Documentation
          </Link>
          <Link href="/docs/providers" className="hover:text-fd-foreground">
            Providers
          </Link>
          <a href={NPM_URL} className="hover:text-fd-foreground">
            npm
          </a>
          <a href={GITHUB_URL} className="hover:text-fd-foreground">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className="border-b border-fd-border px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h2>
        <p className="mt-3 max-w-2xl text-fd-muted-foreground text-balance">{lead}</p>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}
