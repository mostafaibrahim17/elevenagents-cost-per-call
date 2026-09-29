// Read the bill for one call.
//
//   npm run call-cost -- <conversation_id>
//   npm run call-cost -- <conversation_id> --provider-llm 0.006   (adds the raw-API comparison)
import { parseArgs } from "node:util";
import { callCost, rawApiReprice, usd } from "./lib/cost.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "provider-llm": { type: "string" } },
});
const id = positionals[0];
if (!id) {
  console.error("Usage: npm run call-cost -- <conversation_id> [--provider-llm <usd>]");
  process.exit(1);
}

let c;
try {
  c = await callCost(id);
} catch (err: any) {
  const detail = err?.body?.detail?.message ?? err?.message ?? String(err);
  console.error(`Couldn't read conversation ${id}: ${detail}`);
  process.exit(1);
}
const perMin = (usdTotal: number) => (c.seconds > 0 ? usd(usdTotal / (c.seconds / 60), 3) : "n/a");
const phoneSource = c.onPhoneNetwork ? "Estimate: Twilio inbound list rate" : "Estimate: no phone network on this call";

console.log(`\nConversation ${c.conversationId}: ${c.seconds}s, ${c.billedMinutes.toFixed(4)} billed minutes\n`);
console.table({
  "Platform": {
    source: `Record: ${c.billedMinutes.toFixed(4)} billed minutes`,
    calculation: `${c.billedMinutes.toFixed(4)} x $0.08 list rate`,
    usd: usd(c.platformAtListUsd, 3),
  },
  LLM: { source: "Record: llm_price", calculation: "As billed", usd: usd(c.llmUsd) },
  "ElevenLabs total": { source: "", calculation: "Platform + LLM", usd: usd(c.platformAtListUsd + (c.llmUsd ?? 0), 3) },
  "Phone line": { source: phoneSource, calculation: `${c.phoneMinutes} min x $0.0085`, usd: usd(c.phoneLineUsd, 3) },
  "Estimated total": { source: "", calculation: `${perMin(c.estimatedTotalUsd)} per minute`, usd: usd(c.estimatedTotalUsd, 3) },
});
console.log(`Recorded cost_fiat: ${usd(c.elevenLabsTotalUsd, 3)} (platform valued at ${usd(c.platformUsd, 3)} by your plan). Budget at the list rate.`);
if (c.otherPlatformCategories.length) {
  console.log("Other platform charges, as the record priced them (included in the platform line):");
  console.table(c.otherPlatformCategories);
}

console.log("\nLLM tokens in the record");
console.table({ tokens: c.llmTokens });
console.log(`Cache reads: ${c.cachedInputShare == null ? "n/a" : (100 * c.cachedInputShare).toFixed(1) + "%"} of input tokens`);

if (values["provider-llm"]) {
  const providerLlm = Number(values["provider-llm"]);
  if (!Number.isFinite(providerLlm) || providerLlm < 0) {
    console.error("--provider-llm must be a dollar amount, for example 0.006");
    process.exit(1);
  }
  const raw = rawApiReprice(c, providerLlm);
  console.log("\nEstimate: the same usage at raw API list rates (excludes hosting and engineering time)");
  console.table({ stt: usd(raw.stt, 3), tts: usd(raw.tts, 3), llm: usd(raw.llm, 3), phone: usd(raw.phone, 3), total: usd(raw.total, 3) });
  console.log(`Gap to the estimated platform total: ${perMin(c.estimatedTotalUsd - raw.total)} per minute`);
}
