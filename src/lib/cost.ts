import { existsSync } from "node:fs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Load .env if there is one. process.loadEnvFile exists from Node 20.12.
if (existsSync(".env")) process.loadEnvFile(".env");

// List prices used for the all-in and raw-API figures. Check them before you
// rely on them: they were read from the live pricing pages on 28 Sep 2026.
export const RATES = {
  platformPerMin: 0.08, // ElevenAgents additional minute, every plan
  twilioInboundPerMin: 0.0085, // Twilio US local inbound, billed in whole minutes
  scribeRealtimePerHour: 0.39, // Scribe v2 Realtime
  flashTtsPer1kChars: 0.04, // Flash text to speech
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
  platformUsd: number | null; // what the record valued all platform charges at
  otherPlatformCategories: { category: string; quantity: number; usd: number }[]; // e.g. silence, burst
  platformAtListUsd: number; // billed minutes at the $0.08 list rate
  llmUsd: number | null;
  elevenLabsTotalUsd: number | null; // cost_fiat: platform + LLM, no phone line
  phoneMinutes: number; // call length rounded up to whole minutes, as Twilio bills
  phoneLineUsd: number; // estimate at Twilio's inbound list rate, not read from the record
  onPhoneNetwork: boolean; // false for WebSocket calls, where no carrier is involved
  estimatedTotalUsd: number; // platform at list rate + LLM as recorded + phone line estimate
  llmTokens: ReturnType<typeof sumTokens>; // the record's initiated_generation block
  cachedInputShare: number | null;
  ttsCharacters: number | null;
  asrSeconds: number | null;
};

// Everything that matters about one call's bill, read from the conversation details endpoint.
export async function callCost(conversationId: string, el: ElevenLabsClient = client()): Promise<CallCost> {
  const conv: any = await el.conversationalAi.conversations.get(conversationId);
  const m = conv.metadata;
  const c = m.charging ?? {}; // older or in-progress records may have no charging block
  const categories: Record<string, { quantity?: number; price?: number }> = c.platformUsage?.categoryUsage ?? {};
  const billedMinutes: number = categories.voice?.quantity ?? m.callDurationSecs / 60;
  // Only voice minutes are priced at the list rate below. Anything else the record bills,
  // such as silence (5% of the rate) or burst minutes, is listed as the record priced it.
  const otherPlatformCategories = Object.entries(categories)
    .filter(([k]) => k !== "voice")
    .map(([category, v]) => ({ category, quantity: v.quantity ?? 0, usd: v.price ?? 0 }));
  const otherUsd = otherPlatformCategories.reduce((n, o) => n + o.usd, 0);
  const llmTokens = sumTokens(c.llmUsage?.initiatedGeneration?.modelUsage);
  const phoneMinutes = Math.ceil(m.callDurationSecs / 60);
  const phoneLineUsd = phoneMinutes * RATES.twilioInboundPerMin;
  const platformAtListUsd = billedMinutes * RATES.platformPerMin + otherUsd;
  const allInput = llmTokens.fresh + llmTokens.cached;
  return {
    conversationId,
    seconds: m.callDurationSecs,
    billedMinutes,
    platformUsd: c.platformPrice ?? null,
    otherPlatformCategories,
    platformAtListUsd,
    llmUsd: c.llmPrice ?? null,
    elevenLabsTotalUsd: m.costFiat ?? null,
    phoneMinutes,
    phoneLineUsd,
    onPhoneNetwork: m.phoneCall != null,
    estimatedTotalUsd: platformAtListUsd + (c.llmPrice ?? 0) + phoneLineUsd,
    llmTokens,
    cachedInputShare: allInput ? llmTokens.cached / allInput : null,
    ttsCharacters: c.ttsUsage?.totalCharacters ?? null,
    asrSeconds: c.asrUsage?.totalAudioInputSeconds ?? null,
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
