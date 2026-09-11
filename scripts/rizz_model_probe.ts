/**
 * Probe z-ai-web-dev-sdk gateway: which chat models respond, what's the default,
 * and what does a 429 look like from each.
 * Usage: bun scripts/rizz_model_probe.ts [model ...]
 */
export {};

const DEFAULT_ZAI_RETRIES = 0;

async function probe(model?: string) {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const zai = await ZAI.create();
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: "reply with exactly: ok" },
      { role: "user", content: "ok?" },
    ],
    thinking: { type: "disabled" },
  };
  if (model) body.model = model;
  const t0 = Date.now();
  try {
    const res = await zai.chat.completions.create(body as never);
    const text = res?.choices?.[0]?.message?.content ?? "";
    console.log(
      `OK   ${model ?? "(default)"}  served=${res?.model ?? "?"}  ${Date.now() - t0}ms  text=${JSON.stringify(text.slice(0, 40))}`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`FAIL ${model ?? "(default)"}  ${Date.now() - t0}ms  ${msg.slice(0, 120)}`);
  }
}

const args = process.argv.slice(2);
const models = args.length
  ? args
  : [
      undefined,
      "glm-4-flash",
      "glm-4-flash-250414",
      "glm-4-flashx",
      "glm-4.5-air",
      "glm-4.6",
      "glm-4-plus",
      "glm-4.5-flash",
      "glm-4.7-flash",
    ];
for (const m of models) {
  await probe(m);
}
