import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// List prices used for the all-in and raw-API figures. Check them before you
// rely on them: they were read from the live pricing pages on 26 Sep 2026.
export const RATES = {
  platformPerMin: 0.08, // ElevenAgents additional minute, every plan
  twilioInboundPerMin: 0.0085, // Twilio US local inbound, billed in whole minutes
  scribeRealtimePerHour: 0.39, // Scribe v2 Realtime
  flashTtsPer1kChars: 0.05, // Flash text to speech
};

export function client(): ElevenLabsClient {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY (see .env.example).");
  return new ElevenLabsClient({ apiKey });
}

type TokenBlock = { tokens?: number; price?: number };
type ModelUsage = Record<
  string,
  { input?: TokenBlock; inputCacheRead?: TokenBlock; inputCacheWrite?: TokenBlock; outputTotal?: TokenBlock }
>;

function sumTokens(usage: ModelUsage | undefined) {
  const out = { fresh: 0, cached: 0, output: 0, price: 0 };
  for (const u of Object.values(usage ?? {})) {
    out.fresh += u.input?.tokens ?? 0;
    out.cached += u.inputCacheRead?.tokens ?? 0;
    out.output += u.outputTotal?.tokens ?? 0;
    out.price += (u.input?.price ?? 0) + (u.inputCacheRead?.price ?? 0) + (u.inputCacheWrite?.price ?? 0) + (u.outputTotal?.price ?? 0);
  }
  return out;
}

export type CallCost = {
  conversationId: string;
  seconds: number;
  billedMinutes: number;
  platformUsd: number | null; // what the record valued the platform minutes at
  platformAtListUsd: number; // billed minutes at the $0.08 list rate
  llmUsd: number | null;
  elevenLabsTotalUsd: number | null; // cost_fiat: platform + LLM, no phone line
  phoneLineUsd: number; // Twilio inbound estimate, whole minutes
  allInAtListUsd: number;
  tokens: {
    initiated: ReturnType<typeof sumTokens>; // what you are billed on
    irreversible: ReturnType<typeof sumTokens>; // what the caller heard
  };
  cachedInputShare: number | null;
  ttsCharacters: number | null;
  asrSeconds: number | null;
  perGeneration: { fresh: number; cached: number; output: number }[];
};

// Everything that matters about one call's bill, read from the conversation details endpoint.
export async function callCost(conversationId: string): Promise<CallCost> {
  const conv: any = await client().conversationalAi.conversations.get(conversationId);
  const m = conv.metadata;
  const c = m.charging ?? {};
  const billedMinutes: number = c.platformUsage?.categoryUsage?.voice?.quantity ?? m.callDurationSecs / 60;
  const initiated = sumTokens(c.llmUsage?.initiatedGeneration?.modelUsage);
  const irreversible = sumTokens(c.llmUsage?.irreversibleGeneration?.modelUsage);
  const phoneLineUsd = Math.ceil(m.callDurationSecs / 60) * RATES.twilioInboundPerMin;
  const platformAtListUsd = billedMinutes * RATES.platformPerMin;
  const perGeneration = (conv.transcript ?? [])
    .filter((t: any) => t.llmUsage?.modelUsage)
    .map((t: any) => {
      const s = sumTokens(t.llmUsage.modelUsage);
      return { fresh: s.fresh, cached: s.cached, output: s.output };
    });
  const allInput = initiated.fresh + initiated.cached;
  return {
    conversationId,
    seconds: m.callDurationSecs,
    billedMinutes,
    platformUsd: c.platformPrice ?? null,
    platformAtListUsd,
    llmUsd: c.llmPrice ?? null,
    elevenLabsTotalUsd: m.costFiat ?? null,
    phoneLineUsd,
    allInAtListUsd: platformAtListUsd + (c.llmPrice ?? 0) + phoneLineUsd,
    tokens: { initiated, irreversible },
    cachedInputShare: allInput ? initiated.cached / allInput : null,
    ttsCharacters: c.ttsUsage?.totalCharacters ?? null,
    asrSeconds: c.asrUsage?.totalAudioInputSeconds ?? null,
    perGeneration,
  };
}

// The same call re-priced from the raw APIs. The LLM line has to come from
// your provider's own rate, because ElevenLabs' LLM discount doesn't follow you off the platform.
export function rawApiReprice(cost: CallCost, llmAtProviderRateUsd: number) {
  const stt = (cost.seconds / 3600) * RATES.scribeRealtimePerHour; // open stream for the whole call
  const tts = ((cost.ttsCharacters ?? 0) / 1000) * RATES.flashTtsPer1kChars;
  const total = stt + tts + llmAtProviderRateUsd + cost.phoneLineUsd;
  return { stt, tts, llm: llmAtProviderRateUsd, phone: cost.phoneLineUsd, total };
}

export const usd = (n: number | null, dp = 4) => (n == null ? "n/a" : `$${n.toFixed(dp)}`);
