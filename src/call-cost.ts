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
const perMin = (usdTotal: number) => (c.billedMinutes > 0 ? usd(usdTotal / c.billedMinutes, 3) : "n/a");

console.log(`\nConversation ${c.conversationId}: ${c.seconds}s, ${c.billedMinutes.toFixed(2)} billed minutes\n`);
console.table({
  "Platform (list rate)": { usd: usd(c.platformAtListUsd, 3), note: `record valued it at ${usd(c.platformUsd, 3)}` },
  LLM: { usd: usd(c.llmUsd), note: "billed on initiated generations" },
  "ElevenLabs total": { usd: usd(c.platformAtListUsd + (c.llmUsd ?? 0), 3), note: `cost_fiat in the record: ${usd(c.elevenLabsTotalUsd, 3)}` },
  "Phone line (est.)": { usd: usd(c.phoneLineUsd, 3), note: "Twilio inbound, whole minutes" },
  "All in": { usd: usd(c.allInAtListUsd, 3), note: `${perMin(c.allInAtListUsd)} per minute` },
});
if (c.otherPlatformCategories.length) {
  console.log("Other platform charges, as the record priced them (included in the platform line):");
  console.table(c.otherPlatformCategories);
}

const { initiated: ini, irreversible: irr } = c.tokens;
console.log("LLM tokens");
console.table({
  "initiated (billed)": ini,
  "irreversible (heard)": irr,
});
console.log(`Cached share of billed input: ${c.cachedInputShare == null ? "n/a" : (100 * c.cachedInputShare).toFixed(1) + "%"}`);
if (irr.fresh > 0 && ini.fresh > irr.fresh) {
  const pct = Math.round((100 * (ini.fresh - irr.fresh)) / irr.fresh);
  console.log(`Billed fresh input is ${pct}% above what the caller heard. Check the transcript for interrupted turns.`);
} else if (irr.fresh === 0) {
  console.log("The record has no irreversible (heard) usage to compare against.");
}

console.log("\nPer generation (from the transcript)");
console.table(c.perGeneration);

if (values["provider-llm"]) {
  const providerLlm = Number(values["provider-llm"]);
  if (!Number.isFinite(providerLlm) || providerLlm < 0) {
    console.error("--provider-llm must be a dollar amount, for example 0.006");
    process.exit(1);
  }
  const raw = rawApiReprice(c, providerLlm);
  console.log("Same call on the raw APIs (excludes hosting and engineering time)");
  console.table({ stt: usd(raw.stt, 3), tts: usd(raw.tts, 3), llm: usd(raw.llm, 3), phone: usd(raw.phone, 3), total: usd(raw.total, 3) });
  console.log(`Platform gap: ${perMin(c.allInAtListUsd - raw.total)} per minute`);
}
