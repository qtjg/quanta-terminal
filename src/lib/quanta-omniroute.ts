/*
 * QUANTA OmniRoute — smart task-type routing across free AI providers.
 *
 * Classifies a prompt (code / math / translate / summarize / general) with
 * cheap deterministic heuristics, then picks the best model from providers
 * that actually have a key configured (honest: never routes to a provider
 * that would fail on a missing key). Zero keys → stays on the zero-config
 * builtin gateway. Pure functions — fully unit-testable.
 */

export type TaskType = "code" | "math" | "translate" | "summarize" | "general";

export interface TaskClass { type: TaskType; reason: string }

/** cheap deterministic task classifier (runs client-side, no AI spent) */
export function classifyTask(prompt: string): TaskClass {
  const p = prompt.toLowerCase().slice(0, 600);
  if (
    /\b(code|function|script|debug|bug|stack ?trace|regex|sql|api|compile|refactor|typescript|javascript|python|java|rust|go|css|html|component)\b/.test(p) ||
    /[{};]\s*$/m.test(p) || /=>/.test(p)
  ) return { type: "code", reason: "programming keywords / code shape" };
  if (
    /\b(calculate|compute|solve|equation|derivative|integral|probability|percent)/.test(p) ||
    /\d+\s*[+\-*/x×÷^]\s*\d+/.test(p) ||
    /^[\d\s+\-*/^().%]+$/.test(p.trim())
  ) return { type: "math", reason: "arithmetic / calculation shape" };
  if (
    /\btranslate\b/.test(p) ||
    /\bin (japanese|chinese|spanish|french|german|hindi|korean|italian|portuguese|russian|arabic)\b/.test(p)
  ) return { type: "translate", reason: "translation request" };
  if (/\b(summar\w*|tl;?dr|shorten|condense|key points)\b/.test(p)) {
    return { type: "summarize", reason: "summarization request" };
  }
  return { type: "general", reason: "default lane" };
}

/** which free-model id patterns serve each task lane best (checked in order) */
export const ROUTE_PREF: Record<TaskType, string[]> = {
  code: ["deepseek", "qwen", "coder", "llama-3.3"],
  math: ["deepseek", "llama-3.3", "70b"],
  translate: ["qwen", "gemma", "mistral"],
  summarize: ["llama", "mistral", "qwen"],
  general: [],
};

/** provider preference order for routing (builtin excluded — it is the fallback) */
export const ROUTE_PROVIDER_ORDER = ["openrouter", "groq", "gemini", "cerebras"];

export interface RouteInput {
  id: string;
  hasKey: boolean;
  freeModels: string[];
}

export interface RoutePick { provider: string; model: string; reason: string }

/**
 * pick the route for a task class given LIVE provider key status.
 * returns null when no keyed provider is available → caller keeps builtin.
 */
export function pickRoute(type: TaskType, providers: RouteInput[]): RoutePick | null {
  for (const pid of ROUTE_PROVIDER_ORDER) {
    const p = providers.find((x) => x.id === pid && x.hasKey && x.freeModels.length > 0);
    if (!p) continue;
    const prefs = ROUTE_PREF[type];
    const model =
      prefs.map((pat) => p.freeModels.find((m) => m.toLowerCase().includes(pat))).find(Boolean) ??
      p.freeModels[0];
    return {
      provider: p.id,
      model,
      reason: `${type} lane → ${p.id} (${prefs.length ? `matches: ${prefs.join("/")}` : "first free model"})`,
    };
  }
  return null;
}
