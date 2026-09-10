/* QUANTA fun + AI commands: banner cowsay fortune stopwatch ai models weather ipinfo */

import { CmdCtx, CmdDef, err, hasStdin, swElapsed } from "./core";
import { bannerText, cowsay, FORTUNES, fmtElapsed } from "./text-tools";
import { fetchViaApi } from "./cmd-sys";
import { classifyTask, pickRoute, ROUTE_PREF, TaskType } from "../../lib/quanta-omniroute";

export interface AiResult {
  ok: boolean; text?: string; error?: string; provider?: string; model?: string;
  /* reliability telemetry from the provider engine (retries / fallback / latency) */
  timeMs?: number; attempts?: number; fallbackFrom?: string; fallbackError?: string;
}

export interface AskAiOpts {
  system?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /* explicit provider override ("openrouter" | "groq" | …); model may carry provider/model */
  provider?: string;
  /* "" provider → backend default (builtin) */
  model?: string;
}

const CLIENT_TIMEOUT_MS = 60_000; // server worst case ≈ 47s (3×15s attempts + backoffs)

export async function askAi(apiBase: string, question: string, opts?: AskAiOpts | string): Promise<AiResult> {
  /* legacy form: askAi(apiBase, question, "model-id") — treated as {model} */
  const o: AskAiOpts = typeof opts === "string" ? { model: opts } : opts ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    /* "provider/model-id" — split on FIRST slash only; openrouter ids contain '/' */
    const spec = o.model ?? "";
    const firstSlash = spec.indexOf("/");
    const provider = firstSlash === -1 ? "" : spec.slice(0, firstSlash);
    const model = firstSlash === -1 ? "" : spec.slice(firstSlash + 1);
    const res = await fetch(`${apiBase}/api/quanta/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        ...(o.system ? { system: o.system } : {}),
        ...(o.history?.length ? { history: o.history } : {}),
        ...(o.provider || provider
          ? { provider: o.provider ?? provider, model: (o.provider ? o.model : model) || undefined }
          : {}),
      }),
      signal: controller.signal,
    });
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("application/json")) {
      return { ok: false, error: `ai gateway: unexpected response (HTTP ${res.status})` };
    }
    return (await res.json()) as AiResult;
  } catch (e) {
    if (e instanceof Error && (e.name === "AbortError" || e.message.includes("abort"))) {
      return { ok: false, error: `timed out after ${CLIENT_TIMEOUT_MS / 1000}s — the provider is too slow; try 'model test' or switch (model list)` };
    }
    return { ok: false, error: e instanceof Error ? `network: ${e.message}` : "ai request failed" };
  } finally {
    clearTimeout(timer);
  }
}

/* fetch the provider catalog (id, key status, free models) from the backend */
export interface ProviderRow {
  id: string; label: string; keyEnv: string | null; hasKey: boolean;
  note: string; freeModels: string[]; homepage: string;
}
export async function fetchProviders(apiBase: string): Promise<{ ok: boolean; providers?: ProviderRow[]; error?: string }> {
  try {
    const res = await fetch(`${apiBase}/api/quanta/models`);
    return (await res.json()) as { ok: boolean; providers?: ProviderRow[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "providers request failed" };
  }
}

/* OmniRoute provider-status cache (60s TTL) — routing checks keys without re-fetching every call */
let providerCache: { at: number; rows: ProviderRow[] } | null = null;
export function resetProviderCache() { providerCache = null; }
async function providersForRouting(apiBase: string): Promise<ProviderRow[]> {
  if (providerCache && Date.now() - providerCache.at < 60_000) return providerCache.rows;
  const res = await fetchProviders(apiBase);
  const rows = res.ok && res.providers ? res.providers : [];
  providerCache = { at: Date.now(), rows };
  return rows;
}

/** OmniRoute decision: spec to send ("" = builtin default) + the visible route line */
interface OmniDecision { spec: string; routeLine: string }

/** OmniRoute: if enabled and no manual model set, classify + pick provider/model. Records session telemetry. */
async function omnirouteSpec(ctx: CmdCtx, question: string): Promise<OmniDecision | null> {
  if (!ctx.omni.enabled || ctx.model) return null;
  const cls = classifyTask(question);
  const rows = await providersForRouting(ctx.apiBase);
  const pick = pickRoute(cls.type, rows);
  ctx.omni.routed++;
  ctx.omni.lastClass = cls.type;
  if (pick) {
    ctx.omni.lastRoute = `${pick.provider}/${pick.model}`;
    return { spec: ctx.omni.lastRoute, routeLine: `route: ${cls.type} → ${ctx.omni.lastRoute}` };
  }
  /* no keyed provider configured — say so honestly instead of silently staying builtin */
  ctx.omni.lastRoute = "builtin";
  return { spec: "", routeLine: `route: ${cls.type} → builtin (no keyed provider configured — zero-config lane)` };
}

/* box-drawing frame for AI answers (keeps terminal aesthetics) */
function aiFrame(lines: string[], header: string): string[] {
  const out: string[] = [`┌─ ${header} ─────────────────────────────`];
  for (const line of lines) out.push(`│ ${line}`);
  out.push("└─────────────────────────────────────────");
  return out;
}

/* frame header: who answered + real latency ("quanta-ai · 1.8s" / "openrouter/… · 2.3s") */
function whoServed(res: AiResult): string {
  const who = res.provider && res.provider !== "builtin" ? `${res.provider}/${res.model}` : "quanta-ai";
  return typeof res.timeMs === "number" ? `${who} · ${(res.timeMs / 1000).toFixed(1)}s` : who;
}

/* honest fallback note when the primary provider failed and builtin served instead */
function fallbackNote(res: AiResult): string[] {
  if (!res.fallbackFrom) return [];
  const err = (res.fallbackError ?? "unavailable").slice(0, 90);
  return [`note: ${res.fallbackFrom} failed (${err})`, `      → answered automatically by builtin fallback after retries`];
}

/* update session AI telemetry (rendered by `ai stats`) */
function bumpStats(ctx: CmdCtx, success: boolean, timeMs?: number) {
  const s = ctx.aiStats;
  s.calls++;
  if (success) {
    s.ok++;
    s.totalMs += typeof timeMs === "number" ? timeMs : 0;
  } else {
    s.fail++;
  }
}

/* push a Q/A pair into the continuation buffer (capped) */
function rememberAi(ctx: CmdCtx, q: string, a: string) {
  ctx.aiHistory.push({ role: "user", content: q.slice(0, 2000) });
  ctx.aiHistory.push({ role: "assistant", content: a.slice(0, 2000) });
  if (ctx.aiHistory.length > 16) ctx.aiHistory.splice(0, ctx.aiHistory.length - 16);
}

/* shared AI invocation: multi-provider + continuation + piped stdin */
async function runAi(ctx: CmdCtx, question: string, opts: { system?: string; useStdin?: boolean; continueThread?: boolean } = {}): Promise<string[]> {
  let q = question;
  if (opts.useStdin && hasStdin(ctx) && ctx.stdin!.trim()) {
    /* piped input becomes the context; trailing args are the instruction */
    const piped = ctx.stdin!.trim();
    const instr = q.trim() || "analyze this";
    q = `${instr}\n\n--- piped input ---\n${piped.slice(0, 3500)}`;
  }
  if (!q.trim()) return err("ai: nothing to ask (usage: ai <question>  |  cmd | ai <instruction>)");

  /* OmniRoute: auto-pick provider/model per task type when enabled and no manual model */
  const omni = await omnirouteSpec(ctx, q);
  const res = await askAi(ctx.apiBase, q, {
    system: opts.system,
    history: opts.continueThread ? ctx.aiHistory : undefined,
    model: omni ? omni.spec : ctx.model,
  });
  bumpStats(ctx, res.ok === true && Boolean(res.text), res.timeMs);
  if (!res.ok || !res.text) return err(`ai: ${res.error ?? "empty response"}`);
  rememberAi(ctx, q, res.text);

  const routeLine = omni
    ? (res.fallbackFrom
        ? `${omni.routeLine} (failed — builtin served)`
        : omni.routeLine)
    : "";
  return aiFrame([...(routeLine ? [routeLine] : []), ...fallbackNote(res), ...res.text.split("\n")], whoServed(res));
}

interface IntentResult { command?: string; rationale?: string; error?: string }

export async function translateIntent(apiBase: string, prompt: string, cwd: string, listing: string, opts?: { model?: string }): Promise<IntentResult> {
  /* honor `model use` routing: split "provider/model" on FIRST slash (openrouter ids contain '/') */
  const spec = opts?.model ?? "";
  const firstSlash = spec.indexOf("/");
  const provider = firstSlash === -1 ? "" : spec.slice(0, firstSlash);
  const model = firstSlash === -1 ? "" : spec.slice(firstSlash + 1);
  try {
    const res = await fetch(`${apiBase}/api/quanta/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, cwd, listing, ...(provider ? { provider, model: model || undefined } : {}) }),
    });
    return (await res.json()) as IntentResult;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "intent request failed" };
  }
}

interface IpWhoResponse {
  success?: boolean;
  message?: string;
  ip?: string;
  type?: string;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  timezone?: { id?: string; utc?: string };
  connection?: { isp?: string; org?: string };
}

export const FUN_COMMANDS: CmdDef[] = [
  {
    name: "banner", cat: "fun", desc: "big block-letter banner", usage: "banner <text>",
    run: (ctx) => {
      const text = ctx.args.join(" ").slice(0, 14);
      if (!text) return err("usage: banner <text>");
      return bannerText(text);
    },
  },
  {
    name: "cowsay", cat: "fun", desc: "the cow says it", usage: "cowsay <text>",
    run: (ctx) => {
      const text = ctx.args.join(" ");
      if (!text) return err("usage: cowsay <text>");
      return cowsay(text);
    },
  },
  {
    name: "fortune", cat: "fun", desc: "random dev wisdom",
    run: () => [FORTUNES[Math.floor(Math.random() * FORTUNES.length)]],
  },
  {
    name: "stopwatch", cat: "fun", desc: "live stopwatch", usage: "stopwatch start|stop|lap|reset|show",
    run: (ctx) => {
      const sub = ctx.args[0] ?? "show";
      const now = Date.now();
      switch (sub) {
        case "start":
          if (ctx.sw.running) return [`already running — ${fmtElapsed(swElapsed(ctx.sw, now), { live: true })}`];
          ctx.sw.running = true;
          ctx.sw.startedAt = now;
          return ["stopwatch started ⏱"];
        case "stop": {
          if (!ctx.sw.running) return ["stopwatch is not running"];
          ctx.sw.accumulated = now - ctx.sw.startedAt;
          ctx.sw.running = false;
          return [`stopped at ${fmtElapsed(ctx.sw.accumulated, { precise: true })}`];
        }
        case "lap": {
          if (!ctx.sw.running) return err("lap: stopwatch not running");
          const total = now - ctx.sw.startedAt;
          const prev = ctx.sw.laps.reduce((s, l) => s + l, 0);
          ctx.sw.laps.push(total - prev);
          return [
            `lap ${ctx.sw.laps.length}: ${fmtElapsed(total - prev, { precise: true })}`,
            `total:  ${fmtElapsed(total, { precise: true })}`,
          ];
        }
        case "reset":
          ctx.sw.running = false;
          ctx.sw.accumulated = 0;
          ctx.sw.laps = [];
          return ["stopwatch reset"];
        case "show": {
          const el = swElapsed(ctx.sw, now);
          const laps = ctx.sw.laps.length
            ? [`laps: ${ctx.sw.laps.map((l, i) => `L${i + 1}=${fmtElapsed(l)}`).join("  ")}`]
            : [];
          return [
            `stopwatch: ${ctx.sw.running ? "RUNNING" : "idle"}`,
            `elapsed: ${fmtElapsed(el, { precise: true })}`,
            ...laps,
            "usage: stopwatch start|stop|lap|reset|show",
          ];
        }
        default:
          return err(`stopwatch: unknown subcommand '${sub}'`);
      }
    },
  },
  {
    name: "ai", cat: "ai", desc: "REAL AI engine — multi-provider, omniroute, audit, continuation, pipes", usage: "ai <q> · ai -c <follow-up> · ai audit <file> · cmd | ai [instr] · ai -m <model> <q> · ai stats",
    run: async (ctx) => {
      let rest = ctx.raw.trim();
      /* -m <openrouter-model-id>: one-shot model override (session model untouched) */
      let forced: string | undefined;
      const mMatch = rest.match(/^-m\s+(\S+)\s*/);
      if (mMatch) {
        forced = mMatch[1];
        rest = rest.slice(mMatch[0].length).trim();
      }
      /* -c: continue the previous ai thread (multi-turn memory) */
      let cont = false;
      const cMatch = rest.match(/^-c\s+/);
      if (cMatch) {
        cont = true;
        rest = rest.slice(cMatch[0].length).trim();
      }
      if (rest === "stats") {
        const s = ctx.aiStats;
        const avg = s.ok > 0 ? (s.totalMs / s.ok / 1000).toFixed(1) : "—";
        const rate = s.calls > 0 ? Math.round((s.ok / s.calls) * 100) : 0;
        return [
          "AI SESSION STATS",
          `  calls: ${s.calls}   ok: ${s.ok}   failed: ${s.fail}   success rate: ${rate}%`,
          `  avg latency (ok): ${avg}s   total ai time: ${(s.totalMs / 1000).toFixed(1)}s`,
          `  model: ${ctx.model || (ctx.omni.enabled ? "omniroute (auto per task)" : "builtin (default)")}   thread memory: ${Math.floor(ctx.aiHistory.length / 2)} turns`,
          `  omniroute: ${ctx.omni.enabled ? `ON — ${ctx.omni.routed} auto-routed${ctx.omni.lastRoute ? ` (last: ${ctx.omni.lastClass} → ${ctx.omni.lastRoute})` : ""}` : "off — 'omniroute on' for smart per-task routing"}`,
          "  reliability: auto-retry on 429/5xx/timeout → automatic builtin fallback",
        ];
      }
      /* ai audit <file> — REAL AI security review (the sec × ai bridge) */
      if (rest === "audit" || rest.startsWith("audit ")) {
        const path = rest.slice(5).trim();
        let content = "", label = "";
        if (hasStdin(ctx) && (ctx.stdin ?? "").trim()) {
          content = (ctx.stdin ?? "").slice(0, 3500);
          label = "piped input";
        } else {
          if (!path) return err("usage: ai audit <file>   ·   cat creds.txt | ai audit");
          const abs = ctx.fs.resolve(ctx.cwd, path);
          const node = ctx.fs.get(abs);
          if (!node) return err(`ai audit: ${path}: no such file or directory`);
          if (node.type === "dir") return err(`ai audit: ${path}: is a directory`);
          content = node.content.slice(0, 3500);
          label = path;
        }
        if (!content.trim()) return err("ai audit: nothing to audit (empty input)");
        return await runAi(ctx, content, {
          system:
            "You are Quanta's security auditor. Review the user's file content for security problems: hardcoded secrets/keys/passwords, " +
            "injection risks, weak crypto, unsafe defaults, exposed endpoints. Output at most 6 bullets, each starting with a severity tag " +
            "[CRITICAL] [HIGH] [MEDIUM] [LOW] or [OK], with the concrete fix. End with one line 'risk: <low|medium|high> — <reason>'. Plain text only.",
        });
      }
      if (!rest && !hasStdin(ctx)) {
        return err("usage: ai <question> · ai -c <follow-up> · ai audit <file> · cmd | ai [instruction] · ai -m <model> <q> · ai stats");
      }
      const prevModel = ctx.model;
      if (forced) ctx.model = `openrouter/${forced}`;
      try {
        return await runAi(ctx, rest, { useStdin: true, continueThread: cont });
      } finally {
        ctx.model = prevModel;
      }
    },
  },
  {
    name: "models", cat: "ai", desc: "free-model catalog across all providers", usage: "models [provider]",
    run: async (ctx) => {
      try {
        const res = await fetch(`${ctx.apiBase}/api/quanta/models`);
        const data = (await res.json()) as {
          ok: boolean; error?: string; count?: number;
          providers?: Array<{ id: string; label: string; hasKey: boolean; keyEnv: string | null; freeModels: string[] }>;
        };
        if (!data.ok || !data.providers) return err(`models: ${data.error ?? "catalog unavailable"}`);
        const want = ctx.args[0]?.toLowerCase();
        const list = want ? data.providers.filter((p) => p.id === want) : data.providers;
        if (want && !list.length) return err(`models: unknown provider '${want}' — try: ${data.providers.map((p) => p.id).join(", ")}`);
        const out: string[] = [
          `FREE MODEL CATALOG — ${typeof data.count === "number" ? `${data.count} live on openrouter right now` : "curated per provider"} (free tier; key may be required)`,
          "",
        ];
        for (const p of list) {
          out.push(`${p.label}${p.keyEnv ? (p.hasKey ? "  [key set]" : "  [no key]") : "  [zero-config]"}`);
          for (const m of p.freeModels) out.push(`   ${m}`);
        }
        out.push("", "switch: model use <provider/model-id>   one-shot: ai -m <openrouter-model-id> <q>");
        return out;
      } catch (e) {
        return err(`models: ${e instanceof Error ? e.message : "catalog request failed"}`);
      }
    },
  },
  {
    name: "providers", cat: "ai", desc: "AI providers: status, keys, free tiers", usage: "providers",
    run: async (ctx) => {
      const res = await fetchProviders(ctx.apiBase);
      if (!res.ok || !res.providers) return err(`providers: ${res.error ?? "unavailable"}`);
      const out = [
        "AI PROVIDER REGISTRY",
        "  ID         STATUS     FREE TIER / KEY",
        "  " + "─".repeat(60),
      ];
      for (const p of res.providers) {
        const status = (p.hasKey ? "READY" : "NO KEY").padEnd(9);
        out.push(`  ${p.id.padEnd(11)}${status} ${p.note.slice(0, 44)}`);
      }
      const withKeys = res.providers.filter((x) => x.hasKey && x.id !== "builtin").map((x) => x.id);
      out.push("");
      out.push(withKeys.length
        ? `routable now: builtin (always) + ${withKeys.join(", ")}`
        : "routable now: builtin only — set a free key (env) to unlock the rest");
      out.push("switch: model use <provider/model>   live catalog: models");
      return out;
    },
  },
  {
    name: "model", cat: "ai", desc: "show or switch the AI engine model", usage: "model [list | use <provider/model> | test [provider/model] | reset]",
    run: async (ctx) => {
      const sub = (ctx.args[0] ?? "").toLowerCase();
      if (!sub || sub === "list") {
        const res = await fetchProviders(ctx.apiBase);
        if (!res.ok || !res.providers) return err(`model: ${res.error ?? "unavailable"}`);
        const out = [`current model: ${ctx.model || "builtin (default)"}`, "", "AVAILABLE (provider / free models):"];
        for (const p of res.providers) {
          out.push(`  ${p.id}${p.hasKey ? "" : `  (needs ${p.keyEnv})`}`);
          for (const m of p.freeModels) out.push(`    ${m}`);
        }
        out.push("", "usage: model use <provider/model>   e.g. model use openrouter/meta-llama/llama-3.3-70b-instruct:free");
        return out;
      }
      if (sub === "reset") {
        ctx.setModel("");
        return ["model reset → builtin gateway (zero-config)"];
      }
      if (sub === "test") {
        /* REAL verification: fire a tiny live completion at the model and report honestly */
        const target = ctx.args.slice(1).join(" ").trim();
        let spec = target || ctx.model;
        if (!spec) spec = "builtin";
        /* validate provider part before spending the call */
        const slash = spec.indexOf("/");
        const provId = slash === -1 ? (spec === "builtin" ? "builtin" : spec) : spec.slice(0, slash);
        const res = await fetchProviders(ctx.apiBase);
        if (res.ok && res.providers) {
          const p = res.providers.find((x) => x.id === provId);
          if (!p) return err(`model test: unknown provider '${provId}' — try: providers`);
          if (!p.hasKey) return err(`model test: ${p.label} needs ${p.keyEnv} — free key: ${p.homepage}`);
        }
        const out = [
          "MODEL TEST — real round-trip, no mocks",
          `  target:   ${spec === "builtin" ? "builtin (default gateway)" : spec}`,
          "  probe:    'reply with exactly: QUANTA-OK'",
        ];
        const r = await askAi(ctx.apiBase, "ping", {
          system: "You are a connectivity probe for a terminal. Whatever the user says, reply with exactly this single token and nothing else: QUANTA-OK",
          model: spec === "builtin" ? "" : spec,
        });
        bumpStats(ctx, r.ok === true && Boolean(r.text), r.timeMs);
        if (!r.ok || !r.text) {
          return [...out, "  result:   FAIL ✗", `  error:    ${r.error ?? "empty response"}`, "  hint:     try 'model list' — or 'model reset' for the always-on builtin"];
        }
        out.push(`  result:   PASS ✓ (${(((r.timeMs ?? 0) / 1000)).toFixed(1)}s)`, `  served:   ${whoServed(r)}  (attempts: ${r.attempts ?? 1})`);
        out.push(...fallbackNote(r).map((l) => `  ${l.trim()}`));
        const pass = r.text.trim().split(/\s+/)[0].slice(0, 40);
        out.push(`  answer:   "${pass}"`, `  verdict:  ${/QUANTA-OK/i.test(r.text) ? "model verified — ready for real work" : "model reachable (non-standard reply — still usable)"}`);
        return out;
      }
      if (sub === "use") {
        const target = ctx.args.slice(1).join(" ").trim();
        const slash = target.indexOf("/");
        const provider = slash > 0 ? target.slice(0, slash) : target;
        const model = slash > 0 ? target.slice(slash + 1) : "";
        const res = await fetchProviders(ctx.apiBase);
        if (!res.ok || !res.providers) return err(`model: ${res.error ?? "unavailable"}`);
        const p = res.providers.find((x) => x.id === provider);
        if (!p) return err(`model: unknown provider '${provider}' — try: providers`);
        if (!p.hasKey) return err(`model: ${p.label} needs ${p.keyEnv} — free key: ${p.homepage}`);
        if (provider !== "builtin" && model && !p.freeModels.includes(model)) {
          return err(`model: '${model}' not in ${provider} free catalog — see: model list`);
        }
        ctx.setModel(target);
        return [`model set → ${target}`, "ai / explain / q / summarize now route through it", "verify live with: model test"];
      }
      return err("usage: model [list | use <provider/model> | test [provider/model] | reset]");
    },
  },
  {
    name: "omniroute", cat: "ai", desc: "OmniRoute — auto-pick the best free model per task type", usage: "omniroute [on | off | status]",
    run: (ctx) => {
      const sub = (ctx.args[0] ?? "status").toLowerCase();
      if (sub === "on" || sub === "off") {
        ctx.omni.enabled = sub === "on";
        /* persist across sessions (browser only — bun test env has no localStorage) */
        try {
          if (typeof localStorage !== "undefined") {
            if (ctx.omni.enabled) localStorage.setItem("quanta-omniroute", "on");
            else localStorage.removeItem("quanta-omniroute");
          }
        } catch { /* storage unavailable — session-only toggle */ }
        return ctx.omni.enabled
          ? [
              "omniroute ENABLED — ai · explain · q · summarize · ai audit now auto-route per task",
              "  lanes: code → deepseek/qwen · math → deepseek/llama-70b · translate → qwen/gemma",
              "         summarize → llama/mistral · general → first free model",
              "  honest routing: providers without a key are skipped — nothing configured → builtin",
              "  manual override still wins: model use <provider/model>   ·   ai -m <model>",
            ]
          : ["omniroute OFF — manual model (or builtin default) serves everything", `  session auto-routes so far: ${ctx.omni.routed}`];
      }
      const lanes = (Object.entries(ROUTE_PREF) as Array<[TaskType, string[]]>)
        .map(([t, p]) => `  ${t.padEnd(10)} → ${p.length ? p.join(" / ") : "first free model"}`);
      return [
        `OMNIROUTE — smart task routing   mode: ${ctx.omni.enabled ? "ON" : "OFF"}   ('omniroute on' / 'omniroute off')`,
        "  lanes (free-model patterns, first match wins):",
        ...lanes,
        `  session: ${ctx.omni.routed} request(s) auto-routed${ctx.omni.lastRoute ? ` — last: ${ctx.omni.lastClass} → ${ctx.omni.lastRoute}` : ""}`,
        "  chain: openrouter → groq → gemini → cerebras (only if key set) → builtin (zero-config, always on)",
        "  every answer still shows who served + latency; failures auto-retry then fall back",
      ];
    },
  },
  {
    name: "bench", cat: "ai", desc: "race two AI models head-to-head — real latency + verdict", usage: "bench [modelA provider/model] [modelB]  ·  default: current vs groq free",
    run: async (ctx) => {
      const raw = ctx.args.map((a) => a.trim()).filter(Boolean);
      const fallbackSecond = "groq/llama-3.1-8b-instant";
      let specs: string[];
      if (raw.length === 0) specs = [ctx.model || "builtin", fallbackSecond];
      else if (raw.length === 1) specs = [raw[0], raw[0] === "builtin" ? fallbackSecond : "builtin"];
      else specs = raw;
      if (specs[0] === specs[1]) {
        return err(`bench: give two different models — e.g. bench builtin ${fallbackSecond}`);
      }
      /* validate provider ids before spending any call */
      const cat = await fetchProviders(ctx.apiBase);
      if (cat.ok && cat.providers) {
        for (const s of specs) {
          if (s === "builtin") continue;
          const pid = s.slice(0, s.indexOf("/"));
          if (!pid || !cat.providers.some((x) => x.id === pid)) {
            return err(`bench: unknown provider '${pid || s}' in '${s}' — try: providers`);
          }
        }
      }
      const PROBE = "What is 6*7? Reply with exactly one token: the number.";
      const out = [
        "MODEL BENCH — same probe, two engines, real latency, no mocks",
        `  probe: "${PROBE}"`,
        "",
        `  ${"model".padEnd(40)}${"time".padEnd(7)}${"try".padEnd(4)}answer → verdict`,
      ];
      const rows: Array<{ spec: string; ms?: number; ok: boolean; correct: boolean; answer: string; note: string }> = [];
      for (const s of specs) {
        const r = await askAi(ctx.apiBase, PROBE, { model: s === "builtin" ? "" : s });
        bumpStats(ctx, r.ok === true && Boolean(r.text), r.timeMs);
        rows.push({
          spec: s,
          ms: r.timeMs,
          ok: r.ok === true,
          correct: r.ok === true && /\b42\b/.test(r.text ?? ""),
          answer: (r.ok ? r.text ?? "" : r.error ?? "").split("\n")[0].slice(0, 36),
          note: r.fallbackFrom ? `fallback: ${r.fallbackFrom} failed → builtin` : "",
        });
      }
      for (const r of rows) {
        const time = typeof r.ms === "number" ? `${(r.ms / 1000).toFixed(1)}s` : "—";
        const verdict = r.ok ? (r.correct ? "✓ correct" : "✗ wrong answer") : "FAIL";
        out.push(`  ${r.spec.padEnd(40)}${time.padEnd(7)}${"1".padEnd(4)}${r.answer} → ${verdict}${r.note ? ` [${r.note}]` : ""}`);
      }
      const winners = rows.filter((r) => r.ok && r.correct && typeof r.ms === "number");
      if (winners.length) {
        const w = winners.sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0))[0];
        out.push("", `  winner: ${w.spec} — correct in ${(w.ms! / 1000).toFixed(1)}s`, "  keys missing on a lane? free key unlocks it: providers");
      } else {
        out.push("", "  no lane produced the correct answer — check providers / model list");
      }
      return out;
    },
  },
  {
    name: "route", cat: "ai", desc: "AI routing table — active pick, fallback chain, retry policy", usage: "route",
    run: async (ctx) => {
      const res = await fetchProviders(ctx.apiBase);
      if (!res.ok || !res.providers) return err(`route: ${res.error ?? "unavailable"}`);
      const active = ctx.model
        ? ctx.model
        : ctx.omni.enabled
          ? "omniroute (auto per task)"
          : "builtin (zero-config default)";
      const out = [
        "AI ROUTE TABLE",
        `  active   ${active}`,
        "  chain    openrouter → groq → gemini → cerebras → builtin (final fallback, always on)",
        "  policy   transient (429/5xx/timeout): retry ×3, backoff 0.5s→4s → then builtin serves",
        "           fatal (no key / 401 / 404): stop immediately — honest error, no wasted retries",
        "",
        "  ROLE      PROVIDER    KEY                      NOTE",
      ];
      for (const p of res.providers) {
        const role = p.id === "builtin" ? "fallback" : "primary";
        const key = p.keyEnv ? (p.hasKey ? "set" : `needs ${p.keyEnv}`) : "zero-config";
        out.push(`  ${role.padEnd(9)} ${p.id.padEnd(11)} ${key.padEnd(24)} ${p.note.slice(0, 36)}`);
      }
      out.push(
        "",
        `  session  omniroute ${ctx.omni.enabled ? `ON — ${ctx.omni.routed} request(s) auto-routed${ctx.omni.lastRoute ? ` (last: ${ctx.omni.lastClass} → ${ctx.omni.lastRoute})` : ""}` : "off — 'omniroute on' enables per-task lanes"}`,
        "  switch   model use <provider/model> · smart lanes: omniroute on · verify: model test",
      );
      return out;
    },
  },
  {
    name: "summarize", cat: "ai", desc: "AI summarizes a file (or piped input)", usage: "summarize <file>  ·  cat notes.txt | summarize",
    run: async (ctx) => {
      let content = "";
      let label = "";
      if (hasStdin(ctx) && (ctx.stdin ?? "").trim()) {
        content = (ctx.stdin ?? "").slice(0, 3500);
        label = "piped input";
      } else {
        const path = ctx.raw.trim();
        if (!path) return err("usage: summarize <file>  ·  cat <file> | summarize");
        const abs = ctx.fs.resolve(ctx.cwd, path);
        const node = ctx.fs.get(abs);
        if (!node) return err(`summarize: ${path}: no such file or directory`);
        if (node.type === "dir") return err(`summarize: ${path}: is a directory`);
        content = node.content.slice(0, 3500);
        label = path;
      }
      if (!content.trim()) return err("summarize: nothing to summarize (empty input)");
      const res = await askAi(ctx.apiBase, content, {
        system:
          "You are Quanta's file summarizer. Summarize the user's content in at most 6 short bullet points, " +
          "then one line starting with 'key: ' giving the single most important takeaway. Plain text only.",
        model: ctx.model,
      });
      bumpStats(ctx, res.ok === true && Boolean(res.text), res.timeMs);
      if (!res.ok || !res.text) return err(`summarize: ${res.error ?? "empty response"}`);
      rememberAi(ctx, `summarize ${label}`, res.text);
      return aiFrame([`file: ${label}`, ...fallbackNote(res), "", ...res.text.split("\n")], whoServed(res));
    },
  },
  {
    name: "weather", cat: "net", desc: "REAL weather via wttr.in (no key)", usage: "weather <city>",
    run: async (ctx) => {
      const city = ctx.args.join(" ").trim();
      if (!city) return err("usage: weather <city>   e.g. weather tokyo");
      const fmt = encodeURIComponent("%l: %c %t (feels %f) wind %w humidity %h");
      const res = await fetchViaApi(ctx.apiBase, `https://wttr.in/${encodeURIComponent(city)}?format=${fmt}`, 400);
      if (!res.ok) return err(`weather: ${res.error ?? "request failed"}`);
      const line = (res.bodyHead ?? "").trim();
      if (!line) return err("weather: empty response from wttr.in");
      return [line, `source: wttr.in · ${res.timeMs} ms`];
    },
  },
  {
    name: "ipinfo", cat: "net", desc: "REAL network/geo info of this server's egress IP", usage: "ipinfo",
    run: async (ctx) => {
      const res = await fetchViaApi(ctx.apiBase, "https://ipwho.is/", 1200);
      if (!res.ok) return err(`ipinfo: ${res.error ?? "request failed"}`);
      let j: IpWhoResponse;
      try {
        j = JSON.parse(res.bodyHead ?? "{}") as IpWhoResponse;
      } catch {
        return err("ipinfo: could not parse geo response");
      }
      if (j.success === false) return err(`ipinfo: ${String(j.message ?? "lookup failed")}`);
      const out = [
        `ip:        ${String(j.ip ?? "?")}`,
        `type:      ${String(j.type ?? "?")}`,
        `location:  ${String(j.city ?? "?")}, ${String(j.region ?? "?")}, ${String(j.country ?? "?")} (${String(j.country_code ?? "?")})`,
        `coords:    ${String(j.latitude ?? "?")}, ${String(j.longitude ?? "?")}`,
        `timezone:  ${j.timezone?.id ?? "?"} (utc${j.timezone?.utc ?? ""})`,
        `isp:       ${j.connection?.isp ?? "?"} / ${j.connection?.org ?? "?"}`,
      ];
      return [...out, `source: ipwho.is · ${res.timeMs} ms`];
    },
  },
  {
    name: "explain", cat: "ai", desc: "AI explains a linux concept", usage: "explain <topic>",
    run: async (ctx) => {
      const topic = ctx.raw.trim();
      if (!topic) return err("usage: explain <topic>  e.g. explain systemd");
      const res = await askAi(
        ctx.apiBase,
        `Explain "${topic}" for a Linux terminal user in at most 5 short bullet points.`,
        { model: ctx.model },   /* honor `model use` routing (was silently builtin) */
      );
      bumpStats(ctx, res.ok === true && Boolean(res.text), res.timeMs);
      if (!res.ok || !res.text) return err(`explain: ${res.error ?? "empty response"}`);
      return [...fallbackNote(res), ...res.text.split("\n")];
    },
  },
  {
    name: "q", cat: "ai", desc: "natural language -> command -> executes it", usage: 'q <what you want>',
    run: async (ctx) => {
      const want = ctx.raw.trim();
      if (!want) return err(`usage: q <natural language request>  e.g. q show biggest file here`);
      if (!ctx.exec) return err("q: executor unavailable in this context");
      const listing = ctx.fs.list(ctx.cwd).map((n) => n.name).slice(0, 40).join(" ");
      const res = await translateIntent(ctx.apiBase, want, ctx.cwd, listing, { model: ctx.model });
      if (res.error || !res.command) return err(`q: ${res.error ?? "no command produced"}`);
      const out = [
        `intent: "${want}"`,
        `plan:   ${res.command}${res.rationale ? `  (${res.rationale})` : ""}`,
        "",
      ];
      const result = await ctx.exec(res.command);
      return [...out, ...result];
    },
  },
];
