// Roll up a week of real calls for one agent into a cost table.
//
//   npm run report -- <agent_id>
//   npm run report -- <agent_id> --days 30 --csv out/report.csv
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { callCost, client } from "./lib/cost.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { days: { type: "string", default: "7" }, csv: { type: "string" } },
});
const agentId = positionals[0];
if (!agentId) {
  console.error("Usage: npm run report -- <agent_id> [--days 7] [--csv out/report.csv]");
  process.exit(1);
}
const days = Number(values.days);
if (!Number.isFinite(days) || days <= 0) {
  console.error("--days must be a positive number");
  process.exit(1);
}

const el = client();
const since = Math.floor(Date.now() / 1000) - days * 86400;
const ids: string[] = [];
let cursor: string | undefined;
do {
  const page = await el.conversationalAi.conversations.list({ agentId, callStartAfterUnix: since, cursor, pageSize: 100 });
  ids.push(...page.conversations.map((c) => c.conversationId));
  cursor = page.hasMore ? page.nextCursor : undefined;
} while (cursor);

if (!ids.length) {
  console.log(`No conversations for ${agentId} in the last ${values.days} days.`);
  process.exit(0);
}

type Row = {
  conversation: string; minutes: number; platform_list: number; llm: number; phone_est: number;
  all_in: number; cached_share: number | null; fresh_billed_over_heard: number | null; tts_chars: number | null;
};
const rows: Row[] = [];
const skipped: string[] = [];
for (const id of ids) {
  let c;
  try {
    c = await callCost(id, el);
  } catch (err) {
    // An in-progress or failed conversation shouldn't sink the whole report.
    skipped.push(`${id} (${String((err as Error).message ?? err).slice(0, 80)})`);
    continue;
  }
  rows.push({
    conversation: id,
    minutes: +c.billedMinutes.toFixed(2),
    platform_list: +c.platformAtListUsd.toFixed(4),
    llm: +(c.llmUsd ?? 0).toFixed(5),
    phone_est: +c.phoneLineUsd.toFixed(4),
    all_in: +c.allInAtListUsd.toFixed(4),
    cached_share: c.cachedInputShare == null ? null : +c.cachedInputShare.toFixed(2),
    fresh_billed_over_heard: c.tokens.irreversible.fresh ? +(c.tokens.initiated.fresh / c.tokens.irreversible.fresh).toFixed(2) : null,
    tts_chars: c.ttsCharacters,
  });
}

if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join("\n  ")}`);
if (!rows.length) process.exit(0);

console.table(rows);
const sum = (k: keyof Row) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const minutes = sum("minutes");
const perMinute = minutes > 0 ? `$${(sum("all_in") / minutes).toFixed(3)} per minute` : "n/a per minute";
console.log(`${rows.length} calls, ${minutes.toFixed(1)} minutes, $${sum("all_in").toFixed(2)} all in, ${perMinute}`);
if (sum("all_in") > 0) console.log(`LLM is ${((100 * sum("llm")) / sum("all_in")).toFixed(1)}% of the all-in cost.`);

if (values.csv) {
  mkdirSync(dirname(values.csv), { recursive: true });
  const head = Object.keys(rows[0]);
  writeFileSync(values.csv, [head.join(","), ...rows.map((r) => head.map((h) => (r as any)[h] ?? "").join(","))].join("\n") + "\n");
  console.log(`Wrote ${values.csv}`);
}
