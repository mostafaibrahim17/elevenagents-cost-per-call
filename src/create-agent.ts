// Create the test agent used in the article: a support line with one webhook tool.
// Creating an agent and a tool costs nothing. Calls to it use your plan's minutes.
// The ElevenLabs CLI (@elevenlabs/cli) can manage the same agent as config files.
// This uses the SDK so the whole project runs on one dependency.
//
//   npm run create-agent
//   npm run create-agent -- --llm claude-sonnet-5
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { client } from "./lib/cost.js";

const { values } = parseArgs({
  options: {
    llm: { type: "string", default: "gemini-2.5-flash" },
    prompt: { type: "string", default: "agent/prompt.md" },
  },
});

const el = client();

// A webhook tool pointed at httpbin, which echoes the request back. The prompt
// tells the agent how to treat that echo, so no real order system is needed.
const tool: any = await el.conversationalAi.tools.create({
  toolConfig: {
    type: "webhook",
    name: "lookup_order",
    description: "Look up a customer order by its six-digit order number. Returns the order record.",
    responseTimeoutSecs: 10,
    apiSchema: {
      url: "https://httpbin.org/anything/orders",
      method: "GET",
      queryParamsSchema: {
        properties: {
          order_id: { type: "string", description: "The six-digit order number the caller gave, digits only." },
        },
        required: ["order_id"],
      },
    },
  } as any,
});

let agent;
try {
  agent = await el.conversationalAi.agents.create({
  name: "Northwind support (cost test)",
  conversationConfig: {
    agent: {
      firstMessage: "Thanks for calling Northwind Outfitters, this is Sam. How can I help you today?",
      language: "en",
      prompt: {
        prompt: readFileSync(values.prompt!, "utf8"),
        llm: values.llm as any,
        temperature: 0,
        toolIds: [tool.id],
      },
    },
    // English agents must use a Flash v2 or Turbo v2 voice model.
    tts: { modelId: "eleven_flash_v2" as any },
    conversation: { maxDurationSeconds: 360 },
  },
  });
} catch (err) {
  // Don't leave an orphan tool behind if the agent can't be created.
  await el.conversationalAi.tools.delete(tool.id).catch(() => {});
  throw err;
}

console.log(`Tool:  ${tool.id}`);
console.log(`Agent: ${agent.agentId}`);
console.log(`\nNext: npm run scripted-call -- ${agent.agentId}`);
