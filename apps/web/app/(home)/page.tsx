import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Braces, Radio } from "lucide-react";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { CopyCommand } from "@/components/copy-command";
import { GitHubMark } from "@/components/graphics/github-mark";
import { DuplexDiagram } from "@/components/graphics/duplex-diagram";
import { SwapDiagram } from "@/components/graphics/swap-diagram";
import { Waveform } from "@/components/graphics/waveform";
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
    <>
      <Hero />
      <ProviderSwap />
      <Capabilities />
      <Realtime />
      <Formats />
      <Errors />
      <CallToAction />
      <Footer />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-fd-border">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />

      <div className="relative mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 font-mono text-xs text-fd-muted-foreground">
            <Waveform className="h-3 w-4 text-ember-500" bars={4} animated />
            Open source · MIT
          </span>

          <h1 className="mt-6 font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            One interface for text-to-speech and speech-to-text
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground text-pretty">
            A TypeScript SDK for Cartesia, Deepgram, and ElevenLabs. Batch and realtime, with the same types
            for every provider.
          </p>

          <div className="mt-8 w-full max-w-xl">
            <CopyCommand command="pnpm add @swungstudent/voice @swungstudent/deepgram" />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs/quickstart"
              className="inline-flex h-11 min-w-[152px] items-center justify-center gap-2 rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started
              <ArrowRight className="size-4" />
            </Link>
            <a
              href={GITHUB_URL}
              className="inline-flex h-11 min-w-[152px] items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 text-sm font-medium transition-colors hover:bg-fd-accent"
            >
              <GitHubMark className="size-4" />
              GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProviderSwap() {
  return (
    <Section
      eyebrow="Portability"
      title="Write once, run on any provider"
      lead="The provider is chosen in the constructor. Everything after it uses the same methods, the same inputs, and the same return types."
    >
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <Tabs items={PROVIDER_SAMPLES.map((sample) => sample.name)}>
          {PROVIDER_SAMPLES.map((sample) => (
            <Tab key={sample.id} value={sample.name}>
              <DynamicCodeBlock lang="ts" code={sample.code} />
            </Tab>
          ))}
        </Tabs>

        <SwapDiagram />
      </div>

      <p className="mt-8 text-sm text-fd-muted-foreground">
        Providers declare the core package as a peer dependency, so an application resolves a single copy of
        the types.{" "}
        <Link href="/docs/providers" className="text-brand underline underline-offset-4">
          Compare the providers
        </Link>
      </p>
    </Section>
  );
}

const CAPABILITIES = [
  {
    name: "tts",
    methods: "speak() · speakStream()",
    description: "Convert text to audio, buffered or streamed.",
  },
  {
    name: "stt",
    methods: "transcribe()",
    description: "Convert a complete recording to a transcript.",
  },
  {
    name: "realtimeTTS",
    methods: "openTTSSession()",
    description: "Stream text into a session and receive audio back.",
  },
  {
    name: "realtimeSTT",
    methods: "openSTTSession()",
    description: "Stream audio into a session and receive transcripts back.",
  },
];

const MATRIX = [
  { name: "Cartesia", listVoices: true, timings: "Word" },
  { name: "Deepgram", listVoices: false, timings: "None" },
  { name: "ElevenLabs", listVoices: true, timings: "Character" },
];

function Capabilities() {
  return (
    <Section
      eyebrow="Surface"
      title="Four capabilities"
      lead="Each provider declares which capabilities it supports. Calling a method a provider does not implement throws a CapabilityError with the provider name."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {CAPABILITIES.map((capability) => (
          <div
            key={capability.name}
            className="rounded-lg border border-fd-border bg-fd-card p-5 transition-colors hover:border-ember-500/40"
          >
            <div className="flex items-center gap-2">
              {capability.name.startsWith("realtime") ? (
                <Radio className="size-4 text-ember-500" />
              ) : (
                <Braces className="size-4 text-ember-500" />
              )}
              <p className="font-mono text-sm font-medium">{capability.name}</p>
            </div>
            <p className="mt-2 font-mono text-xs text-fd-muted-foreground">{capability.methods}</p>
            <p className="mt-3 text-sm text-fd-muted-foreground">{capability.description}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-fd-border bg-fd-card">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="border-b border-fd-border text-fd-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left font-medium">Provider</th>
              <th className="px-3 py-3 font-mono text-xs font-normal">tts</th>
              <th className="px-3 py-3 font-mono text-xs font-normal">stt</th>
              <th className="px-3 py-3 font-mono text-xs font-normal">realtimeTTS</th>
              <th className="px-3 py-3 font-mono text-xs font-normal">realtimeSTT</th>
              <th className="px-3 py-3 font-mono text-xs font-normal">listVoices</th>
              <th className="px-5 py-3 text-right font-medium">Timings</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((provider) => (
              <tr key={provider.name} className="border-b border-fd-border last:border-0">
                <td className="px-5 py-3 font-medium">{provider.name}</td>
                <Yes />
                <Yes />
                <Yes />
                <Yes />
                <td className="px-3 py-3 text-center">
                  {provider.listVoices ? <Dot on /> : <span className="text-fd-muted-foreground">—</span>}
                </td>
                <td className="px-5 py-3 text-right text-fd-muted-foreground">{provider.timings}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm text-fd-muted-foreground">
        Deepgram does not expose a voice listing endpoint, so the provider does not implement{" "}
        <code className="font-mono text-xs">listVoices()</code>.
      </p>
    </Section>
  );
}

function Yes() {
  return (
    <td className="px-3 py-3 text-center">
      <Dot on />
    </td>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block size-1.5 rounded-full ${on ? "bg-ember-500" : "bg-fd-border"}`}
      aria-label={on ? "supported" : "not supported"}
    />
  );
}

function Realtime() {
  return (
    <Section
      eyebrow="Realtime"
      title="Duplex sessions in both directions"
      lead="A session keeps one connection open and streams in both directions. Push text and receive audio, or push audio and receive transcripts."
    >
      <DuplexDiagram className="mb-8" />

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 font-mono text-xs tracking-wide text-fd-muted-foreground uppercase">
            Speaking
          </h3>
          <DynamicCodeBlock lang="ts" code={REALTIME_TTS} />
        </div>
        <div>
          <h3 className="mb-3 font-mono text-xs tracking-wide text-fd-muted-foreground uppercase">
            Listening
          </h3>
          <DynamicCodeBlock lang="ts" code={REALTIME_STT} />
        </div>
      </div>

      <p className="mt-8 text-sm text-fd-muted-foreground">
        Transcript events carry one of three finality levels: <code>partial</code> for text that is still
        being revised, <code>final</code> for a stable segment, and <code>turn_end</code> when the speaker
        stops.{" "}
        <Link href="/docs/guides/realtime-stt" className="text-brand underline underline-offset-4">
          Realtime transcription
        </Link>
      </p>
    </Section>
  );
}

function Formats() {
  return (
    <Section
      eyebrow="Audio"
      title="Formats resolve to a known value"
      lead="Every field in a format request is optional. Every field in the format you get back is set, so downstream code always knows how to play the bytes."
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
        <DynamicCodeBlock lang="ts" code={RESOLVED_FORMAT} />

        <div className="space-y-4">
          {[
            {
              provider: "ElevenLabs",
              spelling: "mp3_44100_128",
              note: "container, sample rate and bitrate in one token",
            },
            { provider: "Cartesia", spelling: "pcm_mulaw", note: "codec names carry a prefix" },
            {
              provider: "Deepgram",
              spelling: "?encoding=linear16&sample_rate=24000",
              note: "split across query parameters",
            },
          ].map((row) => (
            <div key={row.provider} className="rounded-lg border border-fd-border bg-fd-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{row.provider}</p>
                <code className="truncate font-mono text-xs text-brand">{row.spelling}</code>
              </div>
              <p className="mt-1.5 text-xs text-fd-muted-foreground">{row.note}</p>
            </div>
          ))}
          <p className="text-sm text-fd-muted-foreground">
            You write one <code className="font-mono text-xs">AudioFormat</code>. The provider package
            translates it.
          </p>
        </div>
      </div>
    </Section>
  );
}

function Errors() {
  return (
    <Section
      eyebrow="Errors"
      title="Invalid requests fail before the network call"
      lead="Format support differs the most between providers, so requests are validated locally. Errors name the field instead of returning a 400 from the API."
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        <DynamicCodeBlock lang="ts" code={VALIDATION} />

        <div className="space-y-3">
          {[
            {
              name: "CapabilityError",
              when: "The provider does not implement the method you called.",
            },
            { name: "ConfigError", when: "A required option is missing, such as an API key." },
            { name: "ValidationError", when: "A request field is not supported by the provider." },
          ].map((error) => (
            <div key={error.name} className="rounded-lg border border-fd-border bg-fd-card p-4">
              <p className="font-mono text-sm font-medium text-brand">{error.name}</p>
              <p className="mt-1.5 text-sm text-fd-muted-foreground">{error.when}</p>
            </div>
          ))}
          <p className="text-sm text-fd-muted-foreground">
            All three extend <code className="font-mono text-xs">VoiceError</code>, so a single{" "}
            <code className="font-mono text-xs">catch</code> covers the SDK.
          </p>
        </div>
      </div>
    </Section>
  );
}

function CallToAction() {
  return (
    <section className="border-b border-fd-border px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-2xl border border-fd-border bg-fd-card px-6 py-14 text-center">
          <Waveform
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full text-ember-500/10"
            bars={48}
          />
          <div className="relative">
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              Start with a working example
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-fd-muted-foreground">
              Six runnable programs covering synthesis, transcription, realtime sessions, and switching
              providers.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/docs/quickstart"
                className="inline-flex h-11 min-w-[152px] items-center justify-center rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
              >
                Read the quickstart
              </Link>
              <Link
                href="/docs/examples"
                className="inline-flex h-11 min-w-[152px] items-center justify-center rounded-md border border-fd-border px-4 text-sm font-medium transition-colors hover:bg-fd-accent"
              >
                Browse examples
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 text-sm text-fd-muted-foreground">
        <span className="flex items-center gap-2">
          <Waveform className="h-3.5 w-4 text-ember-500" bars={4} />
          <span className="font-mono">voice-sdk</span>
          <span>· MIT</span>
        </span>
        <div className="flex flex-wrap gap-6">
          <Link href="/docs" className="hover:text-fd-foreground">
            Docs
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

function Section({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-fd-border px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-xs tracking-widest text-brand uppercase">{eyebrow}</p>
        <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-balance sm:text-[40px] sm:leading-[1.1]">
          {title}
        </h2>
        <p className="mt-4 max-w-2xl leading-relaxed text-fd-muted-foreground text-pretty">{lead}</p>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
