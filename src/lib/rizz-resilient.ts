/**
 * v0.10.1 UNLIMITED — quota-aware auto-resume for /api/rizz callers.
 *
 * The server already rides out upstream AI quota windows with ~4 min of
 * patient in-process retries. If the quota stays busy even after that, this
 * client layer quietly resumes after a cooldown instead of surfacing a
 * dead-end error. Personal build: patience over failure — a generate click
 * keeps working until the AI lane frees up.
 *
 * Tunables: MAX_RESUMES x COOLDOWN_MS ≈ +6 min of client patience on top of
 * the server's ~4 min.
 */
const QUOTA_RE = /quota|rate|429|too many|busy/i;
const MAX_RESUMES = 8;
const COOLDOWN_MS = 45_000;

type RizzResponse = {
  variants?: string[];
  nextMove?: string;
  error?: string;
};

export async function rizzFetchResilient(
  body: unknown,
  onWait?: (n: number, max: number, cooldownS: number) => void
): Promise<{ res: Response; data: RizzResponse }> {
  for (let resume = 0; ; resume++) {
    const res = await fetch("/api/rizz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as RizzResponse;
    const quotaHit =
      (!res.ok || !data.variants) && !!data.error && QUOTA_RE.test(data.error);
    if (!quotaHit || resume >= MAX_RESUMES) return { res, data };
    onWait?.(resume + 1, MAX_RESUMES, Math.round(COOLDOWN_MS / 1000));
    await new Promise((r) => setTimeout(r, COOLDOWN_MS));
  }
}
