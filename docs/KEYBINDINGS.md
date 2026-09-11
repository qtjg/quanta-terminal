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

Notes:

- Completion is registry-aware: it completes command names first, then falls back to
  VFS path completion when the token looks like a path.
- `Ctrl-C` during an AI call aborts the in-flight request client-side; the router's
  in-flight counter is decremented so rate-limit accounting stays honest.
- Mobile: soft keyboards vary — the hidden input keeps focus and the history/completion
  gestures above work through the same handler.

Planned additions live in [ROADMAP.md](../ROADMAP.md) (command palette will register
`Ctrl-P`); this file is updated when new bindings land.
