# ElevenAgents cost per call

Companion code for the article **"Voice agent cost per call: a line-by-line breakdown on ElevenAgents"**.

Voice agent pricing pages quote a per-minute rate. The bill has three lines: the platform minute, the LLM billed by token, and your phone carrier. These scripts let you estimate that bill before you deploy, read it back after every call, and roll it up over a week of real traffic.

## What's in here

| Script | What it does | Needs a key | Spends anything |
|---|---|---|---|
| `npm run estimate` | LLM cost per model for your prompt, via ElevenLabs' cost calculator | No | No |
| `npm run call-cost -- <conversation_id>` | The full bill for one call: platform, LLM, phone line, tokens billed vs heard, cache share, per-generation tokens | Yes | No |
| `npm run report -- <agent_id>` | One row per call for the last 7 days, with totals and an optional CSV | Yes | No |
| `npm run create-agent` | Creates the article's test agent: a support line with one webhook tool | Yes | No |
| `npm run scripted-call -- <agent_id>` | Places a real call with a scripted customer and prints its conversation ID | Yes | About 1.5 call minutes and a few hundred TTS characters |

## Setup

Requires Node 20 or later.

```bash
git clone <this repo>
cd elevenagents-cost-per-call
npm install
cp .env.example .env   # then add your ElevenLabs API key
```

The scripts load `.env` automatically, or read `ELEVENLABS_API_KEY` from your environment.

## Reproduce the article's numbers

```bash
# 1. Estimate first. No key needed.
npm run estimate
npm run estimate -- --pages 12
npm run estimate -- --pages 100 --rag

# 2. Create the test agent and place one scripted call.
npm run create-agent
npm run scripted-call -- <agent_id>

# 3. Read the bill back, and re-price it from the raw APIs.
#    0.006 is the LLM cost at Google's own Gemini 2.5 Flash list price.
npm run call-cost -- <conversation_id> --provider-llm 0.006

# 4. Once real traffic arrives, roll up a week.
npm run report -- <agent_id> --days 7 --csv out/report.csv
```

Your numbers will differ from the article's by a few percent from run to run, because the agent's replies vary. On two runs of the same script, the billed input was 58% and 51% above what the caller heard, and cache reads were 23% of billed input both times.

## Reading the output

- **Platform (list rate)** prices billed minutes at $0.08, the rate for additional minutes on every plan. On the Free plan the record values the same minutes lower. Budget at list, and use the record to reconcile.
- **LLM** is what you're billed. It matches the `initiated_generation` token counts, not `irreversible_generation`. The docs define neither field. The transcript's per-generation counts add up to the irreversible block.
- **Phone line (est.)** is a Twilio US inbound estimate at $0.0085 a minute, rounded up to whole minutes. It isn't in ElevenLabs' `cost_fiat`, and a WebSocket test call doesn't incur it.
- **Cached share** above zero means prompt caching is working. On short calls expect zero for the first several turns.
- **The calculator** in `estimate` is a planning figure. On the measured call it ran about two thirds above the real LLM cost.

## Files

```
agent/prompt.md            the 4,916-character support-agent system prompt
agent/customer-lines.txt   the six scripted customer lines
src/lib/cost.ts            callCost() and rawApiReprice(), shared by the scripts
src/estimate.ts            calculator across six models
src/call-cost.ts           one call's bill
src/report.ts              a week of calls
src/create-agent.ts        the test agent and its webhook tool
src/scripted-call.ts       a real call over the conversation WebSocket
```

The list prices used for the all-in and raw-API figures live in `RATES` in `src/lib/cost.ts`. Check them against the live pricing pages before you rely on them.

## License

MIT
