import { NextResponse } from "next/server";
import { providerStatus } from "@/lib/quanta-providers";

export const dynamic = "force-dynamic";

interface ORModel {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string };
}

/*
 * GET /api/quanta/models — AI model catalog for the terminal.
 *
 * Response is a superset consumed by TWO terminal commands:
 *   - `models`   → {count, models[{id,name,ctx}], providerStatus{openrouter,groq,gemini}}
 *                  live OpenRouter catalog, filtered to the :free tier
 *                  (the catalog endpoint is public — no key needed to LIST)
 *   - `providers`/`model` → {providers: full registry incl. key presence}
 *
 * Key VALUES are never returned — only whether each env key is set.
 */
export async function GET() {
  const providers = providerStatus();

  let models: Array<{ id: string; name: string; ctx: number | null }> = [];
  let catalogNote = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { data?: ORModel[] };
      models = (data.data ?? [])
        .filter((m) => m.id.endsWith(":free"))
        .map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          ctx: typeof m.context_length === "number" ? m.context_length : null,
        }));
      catalogNote = `live from openrouter.ai — ${models.length} free models`;
    } else {
      catalogNote = `openrouter catalog HTTP ${res.status}`;
    }
  } catch (e) {
    catalogNote = `openrouter catalog unreachable: ${e instanceof Error ? e.message : "error"}`;
  }

  return NextResponse.json({
    ok: true,
    count: models.length,
    models: models.slice(0, 60),
    providerStatus: {
      openrouter: providers.find((p) => p.id === "openrouter")?.hasKey ?? false,
      groq: providers.find((p) => p.id === "groq")?.hasKey ?? false,
      gemini: providers.find((p) => p.id === "gemini")?.hasKey ?? false,
      cerebras: providers.find((p) => p.id === "cerebras")?.hasKey ?? false,
    },
    providers,
    catalogNote,
  });
}
