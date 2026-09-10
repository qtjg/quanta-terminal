import { NextRequest, NextResponse } from 'next/server'
import { callProvider, ChatMessage } from '@/lib/quanta-providers'

export const dynamic = 'force-dynamic'

interface AiBody {
  prompt?: string
  cwd?: string
  listing?: string
  /* optional `model use` routing — same contract as /api/quanta/chat */
  provider?: string
  model?: string
}

const COMMANDS = `pwd ls cd cat echo touch mkdir rm mv cp tree find wc head tail grep sort uniq stat df
date whoami uname neofetch env export history theme motd banner clear
regex case ascii url diff base64 calc uuid hash stopwatch ai`

const SYSTEM =
  `You are Quanta, an AI-native terminal. Translate the user's intent into exactly ONE command from this list:\n${COMMANDS}\n` +
  `Session context: cwd=PLACEHOLDER_CWD; files here: PLACEHOLDER_LISTING.\n` +
  `Rules: never invent commands outside the list; prefer safe read-only commands; use flags exactly as specified.\n` +
  `The command MUST be COMPLETE with all its arguments using real file/dir names from the listing — e.g. "cat VERSION", NEVER a bare "cat".\n` +
  `Examples: "read notes.txt" -> {"command":"cat notes.txt"}; "how big is deploy" -> {"command":"du deploy"}; "find error in log" -> {"command":"grep -in error app.log"}.\n` +
  `Reply with STRICT JSON only, no markdown: {"command":"<the single command>","rationale":"<one short sentence, max 120 chars>"}`

/* one intent attempt through the multi-provider engine (timeout/retries/fallback inside) */
async function attempt(prompt: string, cwd: string, listing: string, provider?: string, model?: string) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: SYSTEM
        .replace('PLACEHOLDER_CWD', cwd)
        .replace('PLACEHOLDER_LISTING', listing || '(empty)'),
    },
    { role: 'user', content: prompt },
  ]
  const result = await callProvider(provider || 'builtin', model, messages, { maxTokens: 300 })
  if (!result.ok || !result.text) throw new Error(result.error ?? 'empty model response')
  const raw = result.text.trim()
  const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  const parsed = JSON.parse(jsonText) as { command?: string; rationale?: string }
  if (!parsed.command) throw new Error('missing command in model output')
  return parsed
}

export async function POST(req: NextRequest) {
  let body: AiBody
  try {
    body = (await req.json()) as AiBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const prompt = (body.prompt ?? '').trim()
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  if (prompt.length > 500) return NextResponse.json({ error: 'prompt is too long (max 500 characters)' }, { status: 400 })

  const cwd = (body.cwd ?? '/home/quanta').slice(0, 120)
  const listing = (body.listing ?? '').slice(0, 400)
  const provider = (body.provider ?? '').slice(0, 32)
  const model = (body.model ?? '').slice(0, 120)

  /* one JSON-repair retry: the provider engine already retries transient network
     failures — this second pass only covers malformed model output */
  let lastErr = 'untried'
  for (let attemptNo = 0; attemptNo < 2; attemptNo++) {
    try {
      const parsed = await attempt(prompt, cwd, listing, provider || undefined, model || undefined)
      return NextResponse.json({
        command: parsed.command!.slice(0, 200),
        rationale: (parsed.rationale ?? '').slice(0, 200),
      })
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      if (attemptNo < 1) await new Promise((r) => setTimeout(r, 500))
    }
  }
  return NextResponse.json({ error: `ai backend: ${lastErr}` }, { status: 502 })
}
