// Place a real call to an agent with a scripted customer, then print its conversation ID.
// Uses about 1.5 call minutes of your plan and a few hundred TTS characters.
//
//   npm run scripted-call -- <agent_id>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import WebSocket from "ws";
import { client } from "./lib/cost.js";

const agentId = process.argv[2];
if (!agentId) throw new Error("Usage: npm run scripted-call -- <agent_id>");

const el = client();
const SAMPLE_RATE = 16000; // pcm_16000, 16-bit mono, the agent's default input format
const BYTES_PER_SEC = SAMPLE_RATE * 2;
const CHUNK = BYTES_PER_SEC / 4; // stream 250 ms at a time, like a live microphone
const t0 = Date.now();
const log = (kind: string, text = "") => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${kind.padEnd(7)} ${text}`);

// 1. Turn each customer line into audio once, and cache it.
mkdirSync("out/audio", { recursive: true });
const lines = readFileSync("agent/customer-lines.txt", "utf8").trim().split("\n");
const audio: Buffer[] = [];
for (const [i, text] of lines.entries()) {
  const file = `out/audio/line-${i + 1}.pcm`;
  if (!existsSync(file)) {
    const stream = await el.textToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
      text,
      modelId: "eleven_flash_v2_5",
      outputFormat: "pcm_16000",
    });
    const chunks: Buffer[] = [];
    for await (const c of stream as any) chunks.push(Buffer.from(c));
    writeFileSync(file, Buffer.concat(chunks));
  }
  audio.push(readFileSync(file));
}

// 2. Open the conversation over a signed WebSocket URL.
const { signedUrl } = await el.conversationalAi.conversations.getSignedUrl({ agentId });
const ws = new WebSocket(signedUrl);
let conversationId = "";
let agentTurns = 0;
let playbackEnds = 0; // when the agent's audio would finish playing, in ms
let agentBytesPerSec = BYTES_PER_SEC;
let pending: Buffer = Buffer.alloc(0);

ws.on("open", () => ws.send(JSON.stringify({ type: "conversation_initiation_client_data" })));
ws.on("message", (raw) => {
  const e = JSON.parse(raw.toString());
  switch (e.type) {
    case "conversation_initiation_metadata": {
      const m = e.conversation_initiation_metadata_event;
      conversationId = m.conversation_id;
      const rate = Number(String(m.agent_output_audio_format ?? "pcm_16000").split("_")[1]) || SAMPLE_RATE;
      agentBytesPerSec = rate * 2;
      log("SESSION", conversationId);
      break;
    }
    case "audio": {
      // Audio arrives faster than real time, so track when playback would end.
      const bytes = Buffer.from(e.audio_event.audio_base_64, "base64").length;
      playbackEnds = Math.max(playbackEnds, Date.now()) + (bytes / agentBytesPerSec) * 1000;
      break;
    }
    case "agent_response":
      agentTurns++;
      log("AGENT", e.agent_response_event.agent_response);
      break;
    case "user_transcript":
      log("USER", e.user_transcription_event.user_transcript);
      break;
    case "interruption":
      playbackEnds = 0;
      break;
    case "ping":
      ws.send(JSON.stringify({ type: "pong", event_id: e.ping_event.event_id }));
      break;
  }
});

// 3. Stream silence continuously, and a customer line when it's our turn.
const pump = setInterval(() => {
  if (ws.readyState !== WebSocket.OPEN) return;
  let chunk: Buffer;
  if (pending.length) {
    chunk = pending.subarray(0, CHUNK);
    pending = pending.subarray(CHUNK);
    if (chunk.length < CHUNK) chunk = Buffer.concat([chunk, Buffer.alloc(CHUNK - chunk.length)]);
  } else chunk = Buffer.alloc(CHUNK);
  ws.send(JSON.stringify({ user_audio_chunk: chunk.toString("base64") }));
}, 250);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitForAgent(seen: number, timeoutMs: number, gapMs = 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (agentTurns > seen && Date.now() > playbackEnds + gapMs) break;
    await sleep(100);
  }
  return agentTurns;
}

await new Promise((r) => ws.once("open", r));
let seen = 0;
for (const [i, pcm] of audio.entries()) {
  seen = await waitForAgent(seen, 45_000);
  await sleep(800); // a natural pause before answering
  log("SEND", `line ${i + 1} (${(pcm.length / BYTES_PER_SEC).toFixed(1)}s)`);
  pending = pcm;
  while (pending.length) await sleep(100);
}
await waitForAgent(seen, 30_000, 1500); // let the agent say goodbye
clearInterval(pump);
ws.close();
log("DONE", `conversation ${conversationId}`);
console.log(`\nThe billing record takes a few seconds to settle. Then run:\n  npm run call-cost -- ${conversationId}`);
