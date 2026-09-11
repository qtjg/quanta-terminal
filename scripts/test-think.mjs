import ZAI from "z-ai-web-dev-sdk";

const tweet =
  "If you are building something, drop a wave and tell me what you are working on. Always happy to discover cool projects, exchange ideas, and connect with fellow builders.";

const system = [
  "You are RizzReply, a ghostwriter. You write texts the USER will post under someone else's tweet. You know NOTHING about the user: no name, no job, no product, no history, no achievements. Assume nothing, invent nothing.",
  "The tweet invites people to share what they're working on. The USER has NOT told us what they build. You MUST NOT invent it. Do not write 'I'm building X' or 'exploring X' or 'working on X' — that would be a fabricated fact.",
  "Safe replies: react with genuine interest to the invite, highlight something specific from the tweet, ask the author a smart question. The user can truthfully post these no matter who they are.",
  "Output EXACTLY 3 variants separated by a line containing only ---. Max 280 chars each, ideally under 200. No hashtags. Max one emoji in one variant. Never use the word 'tweet' in text. No numbering.",
].join("\n");

const t0 = Date.now();
const zai = await ZAI.create();
const completion = await zai.chat.completions.create({
  messages: [
    { role: "system", content: system },
    {
      role: "user",
      content: `Here is the tweet by @AditSavani16:\n\n"""${tweet}"""\n\nGenerate the 3 variants now.`,
    },
  ],
  thinking: { type: "enabled" },
});
console.log("latency:", ((Date.now() - t0) / 1000).toFixed(1) + "s");
console.log(completion.choices[0]?.message?.content);
