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
if (!agentId) throw new Error("Usage: npm run report -- <agent_id> [--days 7]");

const since = Math.floor(Date.now() / 1000) - Number(values.days) * 86400;
const ids: string[] = [];
let cursor: string | undefined;
do {
  const page: any = await client().conversationalAi.conversations.list({ agentId, callStartAfterUnix: since, cursor, pageSize: 100 } as any);
  ids.push(...page.conversations.map((c: any) => c.conversationId));
  cursor = page.hasMore ? page.nextCursor : undefined;
} while (cursor);

if (!ids.length) {
  console.log(`No conversations for ${agentId} in the last ${values.days} days.`);
  process.exit(0);
}

type Row = {
  conversation: string; minutes: number; platform_list: number; llm: number; phone_est: number;
  all_in: number; cached_share: number | null; billed_over_heard: number | null; tts_chars: number | null;
};
const rows: Row[] = [];
for (const id of ids) {
  const c = await callCost(id);
  rows.push({
    conversation: id,
    minutes: +c.billedMinutes.toFixed(2),
    platform_list: +c.platformAtListUsd.toFixed(4),
    llm: +(c.llmUsd ?? 0).toFixed(5),
    phone_est: +c.phoneLineUsd.toFixed(4),
    all_in: +c.allInAtListUsd.toFixed(4),
    cached_share: c.cachedInputShare == null ? null : +c.cachedInputShare.toFixed(2),
    billed_over_heard: c.tokens.irreversible.fresh ? +(c.tokens.initiated.fresh / c.tokens.irreversible.fresh).toFixed(2) : null,
    tts_chars: c.ttsCharacters,
  });
}

console.table(rows);
const sum = (k: keyof Row) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const minutes = sum("minutes");
console.log(`${rows.length} calls, ${minutes.toFixed(1)} minutes, $${sum("all_in").toFixed(2)} all in, $${(sum("all_in") / minutes).toFixed(3)} per minute`);
console.log(`LLM is ${((100 * sum("llm")) / sum("all_in")).toFixed(1)}% of the all-in cost.`);

if (values.csv) {
  mkdirSync(dirname(values.csv), { recursive: true });
  const head = Object.keys(rows[0]);
  writeFileSync(values.csv, [head.join(","), ...rows.map((r) => head.map((h) => (r as any)[h] ?? "").join(","))].join("\n") + "\n");
  console.log(`Wrote ${values.csv}`);
}
