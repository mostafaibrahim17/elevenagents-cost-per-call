// Estimate LLM cost per model before you deploy. Needs no API key.
//
//   npm run estimate
//   npm run estimate -- --prompt agent/prompt.md --pages 12 --rag
//   npm run estimate -- --prompt-length 6000 --minutes 4
//   npm run estimate -- --all          (every model, not just the six in the article)
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { RATES } from "./lib/cost.js";

const { values } = parseArgs({
  options: {
    prompt: { type: "string", default: "agent/prompt.md" },
    "prompt-length": { type: "string" },
    pages: { type: "string", default: "0" },
    rag: { type: "boolean", default: false },
    minutes: { type: "string", default: "4" },
    all: { type: "boolean", default: false },
  },
});

const promptLength = Number(values["prompt-length"] ?? readFileSync(values.prompt!, "utf8").length);
const pages = Number(values.pages);
const minutes = Number(values.minutes);
for (const [flag, n] of [["--prompt-length", promptLength], ["--pages", pages], ["--minutes", minutes]] as const) {
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${flag} must be a number of 0 or more`);
    process.exit(1);
  }
}
const models = ["gemini-2.5-flash", "gpt-5-mini", "gemini-3.7-flash", "claude-haiku-4-5", "gpt-5.1", "claude-sonnet-5"];

// The calculator endpoint answers without authentication, so any key string works here.
const el = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY || "none" });
const res = await el.conversationalAi.llmUsage.calculate({
  promptLength,
  numberOfPages: pages,
  ragEnabled: values.rag,
});

const fixed = minutes * RATES.platformPerMin + Math.ceil(minutes) * RATES.twilioInboundPerMin;
const rows = res.llmPrices
  .filter((p) => values.all || models.includes(p.llm))
  .sort((a, b) => a.pricePerMinute - b.pricePerMinute)
  .map((p) => {
    const llm = p.pricePerMinute * minutes;
    return {
      model: p.llm,
      "per min": `$${p.pricePerMinute.toFixed(4)}`,
      [`LLM, ${minutes} min`]: `$${llm.toFixed(3)}`,
      [`all-in, ${minutes} min`]: `$${(fixed + llm).toFixed(2)}`,
      "LLM share": `${Math.round((100 * llm) / (fixed + llm))}%`,
    };
  });

console.log(`Prompt ${promptLength} chars, ${values.pages} KB pages, RAG ${values.rag ? "on" : "off"}, ${minutes}-minute call`);
console.log(`All-in adds the platform at $${RATES.platformPerMin}/min and a Twilio inbound line at $${RATES.twilioInboundPerMin}/min.`);
console.table(rows);
console.log("A planning estimate. On the measured call it ran about two thirds high.");
