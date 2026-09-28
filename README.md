# What one ElevenAgents call actually costs

![The rate is $0.08 a minute. The bill has three lines: platform, LLM, and phone line, adding up to $0.143 for one real 92-second call](assets/hero.svg)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 20.12+](https://img.shields.io/badge/node-20.12%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![ElevenLabs JS SDK 2.69](https://img.shields.io/badge/%40elevenlabs%2Felevenlabs--js-2.69-000000)
![Estimate runs without an API key](https://img.shields.io/badge/estimate-no%20API%20key%20needed-brightgreen)

Companion code for **"Voice agent cost per call: a line-by-line breakdown on ElevenAgents"**.

Pricing pages quote a per-minute rate. The bill has three lines:

- the **platform minute**, which covers speech to text, text to speech, and orchestration
- the **LLM**, billed on top by token
- the **phone line**, billed by your carrier

These scripts **estimate** that bill before you deploy, **read it back** from the conversation details endpoint after every call, and **roll it up** over a week of real traffic. Everything uses the official `@elevenlabs/elevenlabs-js` SDK.

> **TL;DR.** One real 92-second support call cost **$0.143 all in** at list rates. The platform minute was 86% of it, the phone line 12%, and the LLM 2%. Swapping models changes the LLM line by up to 15x. The bill also counts more fresh LLM input than the caller heard, 38% to 71% more across four calls, and prompt caching kicked in with nothing configured. `npm install`, then `npm run estimate` works immediately, with no API key.

![Billing flow: the caller's audio passes through the phone line, then speech to text, the LLM, and text to speech. Speech to text and text to speech sit inside the $0.08 platform minute. The LLM and the phone line are billed on top.](assets/billing-flow.png)

> **Numbers from a handful of calls.** The cost figures come from one scripted call on a fresh account, so read them as a worked example, not a benchmark. Three more runs with this repo's TypeScript `scripted-call` cost within a few cents of it. The token ratios moved more. Billed fresh input ran 58%, 51%, 38% and 71% above what the caller heard, with no turn flagged as interrupted in any of them, and cache reads were 23% to 35% of billed input. Point `npm run report` at a week of your own traffic before you put a number in a budget.

## Contents

- [What's here](#whats-here)
- [Run it](#run-it)
- [What you should see](#what-you-should-see)
- [Notes & gotchas](#notes--gotchas)

## What's here

| Path | What it is | Needs a key | Spends anything |
|------|-----------|:---:|:---:|
| `src/estimate.ts` | LLM cost per model for your prompt, from ElevenLabs' cost calculator | No | No |
| `src/call-cost.ts` | One call's full bill: platform, LLM, phone line, tokens billed vs heard, cache share, per-generation tokens, and an optional raw-API comparison | Yes | No |
| `src/report.ts` | One row per call for the last N days, with totals and an optional CSV | Yes | No |
| `src/create-agent.ts` | The test agent: a support line with one `lookup_order` webhook tool | Yes | No |
| `src/scripted-call.ts` | Places a real call over the conversation WebSocket with six scripted customer lines | Yes | About 1.5 call minutes |
| `src/lib/cost.ts` | `callCost()` and `rawApiReprice()`, shared by the scripts, plus the list prices in `RATES` | | |
| `agent/prompt.md` | The 4,916-character support-agent system prompt | | |
| `agent/customer-lines.txt` | The six scripted customer lines | | |

## Run it

Requires Node 20.12 or later (there's an `.nvmrc` for Node 22). An `ELEVENLABS_API_KEY` is only needed from step 2 on.

```bash
# 0. Clone and install
git clone https://github.com/mostafaibrahim17/elevenagents-cost-per-call
cd elevenagents-cost-per-call
npm install

# 1. Estimate before you deploy. No key needed.
npm run estimate
npm run estimate -- --pages 12            # with a 12-page knowledge base
npm run estimate -- --pages 100 --rag     # with a 100-page knowledge base and RAG on

# 2. Configure
cp .env.example .env                      # add your ElevenLabs API key

# 3. Create the test agent, then place one scripted call
npm run create-agent                      # prints the agent ID
npm run scripted-call -- <agent_id>       # prints the conversation ID

# 4. Read the bill back, and re-price it from the raw APIs.
#    0.006 is the LLM line at Google's own Gemini 2.5 Flash list price.
npm run call-cost -- <conversation_id> --provider-llm 0.006

# 5. Once real traffic arrives, roll up a week
npm run report -- <agent_id> --days 7 --csv out/report.csv
```

The scripts load `.env` automatically, or read `ELEVENLABS_API_KEY` from your environment. `npm run typecheck` checks the whole project under strict TypeScript.

## What you should see

`npm run estimate` prices the same prompt across six models for a four-minute call. The captures below are condensed, with the table borders and some lines trimmed.

![Condensed output of npm run estimate: Gemini 2.5 Flash costs $0.011 in LLM per four-minute call and $0.37 all in, rising to Claude Sonnet 5 at $0.168 and $0.52](assets/demo-estimate.svg)

`npm run call-cost` reads the real bill back and breaks it down. The full output also prints the ElevenLabs total, the per-generation token table, and any silence or burst charges.

![Condensed output of npm run call-cost: platform $0.123 at list rate, LLM $0.0026, phone line $0.017, all in $0.143. Billed fresh input is 58% above what the caller heard. The same call on the raw APIs is $0.070.](assets/demo-call-cost.svg)

- **The platform minute is most of the bill.** At list rate it's $0.123 of the $0.143. With the cheapest model the LLM is 2%.
- **You're billed on generations the caller didn't hear.** The record reports LLM usage twice. The billed price matches `initiatedGeneration`, whose fresh input was 58% above `irreversibleGeneration` on this call, the block that matches the transcript. Across four calls the gap ran 38% to 71%, and no turn was flagged as interrupted in any of them, so the record doesn't say where the extra generations came from.
- **Caching happens by itself, but late.** Cache reads were 23% of billed input on this call, 23% to 35% across four, and appeared only on the last two of seven generations.
- **The raw APIs cost less per call, not less overall.** The same call built from Scribe, Flash, and Gemini comes to $0.070. The gap of about 5 cents a minute pays for turn-taking, streaming, tool calling, and hosting.

![Cost by model: six stacked bars for a four-minute call, each with the $0.32 platform minute and $0.034 phone line fixed, and the LLM rising from $0.011 for Gemini 2.5 Flash to $0.168 for Claude Sonnet 5](assets/model-cost-comparison.png)

## Notes & gotchas

- **Budget at the list rate.** On the Free plan the record values platform minutes below $0.08, and shows zero free minutes consumed. The pricing page doesn't say how credits convert to dollars. `call-cost` shows both figures.
- **The calculator is a ceiling, not a forecast.** On the measured call it ran about two thirds above the real LLM cost, because it assumes more messages a minute. The estimator on the pricing page, at its default setting, runs lower. Treat the two as a range.
- **Silence and burst minutes are listed separately.** Voice minutes are priced at the $0.08 list rate. If the record bills other platform categories, such as silence at 5% of the rate or burst minutes, `call-cost` lists them as the record priced them and adds them to the platform line.
- **The phone line isn't in `costFiat`.** It's your carrier's charge. The scripts estimate it at Twilio's US inbound rate, rounded up to whole minutes as Twilio bills it. A WebSocket test call doesn't incur it.
- **`ttsUsage` and `asrUsage` are analytics fields.** The docs say so. They're what make the raw-API comparison possible, but they aren't billing lines.
- **Past about 55 pages, the knowledge base costs more than the model.** At 12 pages the RAG flag makes no difference to the estimate. At 100 pages without RAG, Sonnet 5 reaches $4.34 a call. With RAG it's $1.21. Run `npm run estimate -- --pages <n>` with and without `--rag` for your own size.
- **English agents need a Flash v2 or Turbo v2 voice model.** The API rejects Flash v2.5 for an English agent, which is why `create-agent` uses `eleven_flash_v2`.
- **Why the SDK and not the CLI.** `@elevenlabs/cli` manages agents as config files, which suits teams that keep agents in git. This repo creates its one test agent with the SDK so the whole project runs on a single dependency.
- **Prices move.** The list prices for the all-in and raw-API figures live in `RATES` in `src/lib/cost.ts`, as read on 26 September 2026. Check them before you rely on them.

## License

MIT
