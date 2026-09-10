# Security Policy

## Supported versions

QUANTA is a single-user, client-side terminal that runs **in your browser**. Only the latest released version is supported with security fixes.

| Version | Supported |
|---------|-----------|
| 0.6.x   | ✅ |
| < 0.6   | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

1. Use GitHub's **Private vulnerability reporting** (Security tab → Report a vulnerability), or
2. Contact the maintainer directly via the email on the [GitHub profile](https://github.com/qtjg).

You'll get an acknowledgement within 72 hours, and a fix or a documented mitigation decision within 14 days for confirmed issues.

## Scope and design context

Understanding what QUANTA is — and deliberately is not — helps frame reports:

- **Sandboxed by design.** The filesystem is a virtual, in-browser filesystem (`localStorage`). Commands like `rm`, `chmod`, `sudo` operate only on VFS state. They cannot touch your real machine. Reports claiming otherwise should include reproduction steps.
- **API keys are yours.** Provider keys (OpenRouter/Groq/Gemini/Cerebras) are entered by the user, stored client-side, and sent only to the configured provider over HTTPS. QUANTA's own API routes proxy requests without storing keys or conversation content server-side.
- **Rate limiting exists** (`src/lib/rate-limit.ts`) on AI endpoints to prevent abuse of publicly-hosted deployments.
- **Security toolkit is educational.** The `sec` command group (port scanning, header audit, entropy analysis, recon) targets hosts the user explicitly names, for learning and defensive analysis. It performs no exploits and stores no results.

## Known non-issues

- `sudo` granting no real privileges — intentional (documented in `man sudo`).
- localStorage persistence being readable by same-origin scripts — that is a property of the platform, not a QUANTA vulnerability.
