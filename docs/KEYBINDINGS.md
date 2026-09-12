# Keybindings

The terminal is keyboard-first. Current bindings, straight from the input handler in
`src/components/quanta/terminal.tsx`:

| Keys | Action |
|------|--------|
| `Enter` | execute the current line |
| `↑` / `↓` | walk command history (stored per session, restored on boot) |
| `Tab` | complete the current token against the command registry and VFS paths |
| `Ctrl-L` | clear the screen (scrollback stays in memory) |
| `Ctrl-C` | cancel the current line / interrupt the active command |
| `Ctrl-K` / `Ctrl-P` | open the command palette — fuzzy finder over the command registry; `↑/↓` + `Enter` run (or prefill usage for arg-taking commands), `Esc` or repeat closes |
| `Ctrl-R` | reverse-i-search over your command history — fuzzy filter, `Enter` re-runs the pick, `Tab`/`→` or click prefills the input, `Esc` or repeat closes |

Notes:

- Completion is registry-aware: it completes command names first, then falls back to
  VFS path completion when the token looks like a path.
- `Ctrl-C` during an AI call aborts the in-flight request client-side; the router's
  in-flight counter is decremented so rate-limit accounting stays honest.
- Mobile: soft keyboards vary — the hidden input keeps focus and the history/completion
  gestures above work through the same handler.

Planned additions live in [ROADMAP.md](../ROADMAP.md); this file is updated when new
bindings land.
