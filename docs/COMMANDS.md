# QUANTA Command Reference

**117 commands** across all categories — auto-generated from `scripts/enum-cmds.ts`.
Do not edit by hand; regenerate with `bun scripts/enum-cmds.ts > /dev/null && python3 .zscripts/gen_commands_doc.py` when the catalog changes.

_Every command is really implemented against the persistent virtual filesystem and the command engine — no canned output._


## core (19 commands)

| Command | Description |
|---------|-------------|
| `alias` | list or create aliases |
| `clear` | clear the terminal screen |
| `date` | current date & time |
| `echo` | print text (expands $VAR) |
| `env` | print environment variables |
| `exit` | lock the terminal (reload to boot again) |
| `export` | set an environment variable |
| `help` | show the full command index |
| `history` | show command history |
| `hostname` | print machine hostname |
| `man` | manual page for a command |
| `motd` | message of the day |
| `sudo` | elevated run (honestly: same sandbox) |
| `theme` | list or switch terminal theme |
| `unalias` | remove an alias |
| `uname` | system information |
| `uptime` | session uptime + load |
| `which` | locate a command |
| `whoami` | print current user |

## fs (29 commands)

| Command | Description |
|---------|-------------|
| `basename` | strip directory from path |
| `cat` | print file contents |
| `cd` | change directory |
| `chmod` | change file mode (tracked in VFS) |
| `cp` | copy file |
| `df` | filesystem usage (sandbox volume) |
| `dirname` | strip last component from path |
| `du` | disk usage of a path |
| `find` | find files by name (-name substring) |
| `fsck` | VFS integrity check — walks every node |
| `head` | first N lines (file or pipe) |
| `ls` | list directory contents |
| `mkdir` | create directory (-p for parents) |
| `mv` | move / rename file |
| `nl` | number all lines (file or pipe) |
| `pwd` | print working directory |
| `realpath` | canonical absolute path (resolves . .. ~) |
| `rev` | reverse each line's characters (file or pipe) |
| `rm` | remove file or directory (-r recursive, -f force) |
| `rmdir` | remove an empty directory |
| `sort` | sort lines (file or pipe) |
| `split` | split a file into N-line chunks (xaa, xab, …) |
| `stat` | file metadata |
| `tail` | last N lines (file or pipe) |
| `touch` | create an empty file / bump mtime |
| `tree` | recursive directory tree |
| `uniq` | drop consecutive duplicate lines (file or pipe) |
| `wc` | count lines/words/chars (file or pipe) |
| `write` | write text into a file (VFS) |

## text (24 commands)

| Command | Description |
|---------|-------------|
| `ascii` | ascii/unicode code table |
| `base64` | base64 encode/decode |
| `calc` | safe calculator (no eval) |
| `case` | 11 case transforms |
| `diff` | line diff of two files (LCS) |
| `expand` | expand tabs to spaces (tab stops) |
| `factor` | prime factorization of an integer |
| `fold` | wrap each line at width |
| `grep` | search text (file, pipe or inline) |
| `hash` | sha-1/256/384/512 of text |
| `json` | JSON toolkit — validate, pretty, keys, get, type |
| `lorem` | lorem ipsum filler text generator |
| `pad` | align text left/right/center to width |
| `rand` | random int / pick from list |
| `regex` | regex tester: matches + groups |
| `seq` | print a number sequence |
| `shuf` | shuffle lines (file, pipe or list) |
| `slug` | slugify text → URL-safe identifier |
| `strdist` | Levenshtein edit distance + similarity |
| `units` | unit conversion |
| `url` | url parser + enc/dec |
| `uuid` | generate uuid v4 |
| `wordfreq` | word frequency table (-s skips stop words) |
| `yes` | repeat a string n times (bounded) |

## sys (9 commands)

| Command | Description |
|---------|-------------|
| `cal` | calendar for a month (current or given) |
| `free` | memory overview |
| `kill` | signal a process by pid |
| `lscpu` | cpu info of this device |
| `neofetch` | system summary card |
| `netstat` | sandbox connection table |
| `ps` | process snapshot (quanta services) |
| `top` | one-shot system dashboard |
| `tz` | current time across timezones (real Intl) |

## net (6 commands)

| Command | Description |
|---------|-------------|
| `curl` | REAL http request via quanta backend |
| `headers` | REAL HTTP response headers for a URL |
| `ipinfo` | REAL network/geo info of this server's egress IP |
| `isup` | REAL site availability check (status + latency) |
| `ping` | latency probe (simulated RTT) |
| `weather` | REAL weather via wttr.in (no key) |

## fun (7 commands)

| Command | Description |
|---------|-------------|
| `8ball` | the magic 8-ball answers |
| `banner` | big block-letter banner |
| `cowsay` | the cow says it |
| `dice` | roll NdM dice — total + individual rolls |
| `fortune` | random dev wisdom |
| `matrix` | a frozen frame of digital rain |
| `stopwatch` | live stopwatch |

## ai (11 commands)

| Command | Description |
|---------|-------------|
| `ai` | REAL AI engine — multi-provider, omniroute, audit, continuation, pipes |
| `bench` | race two AI models head-to-head — real latency + verdict |
| `explain` | AI explains a linux concept |
| `model` | show or switch the AI engine model |
| `models` | free-model catalog across all providers |
| `omniroute` | OmniRoute — auto-pick the best free model per task type |
| `providers` | AI providers: status, keys, free tiers |
| `q` | natural language -> command -> executes it |
| `route` | AI routing table — active pick, fallback chain, retry policy |
| `summarize` | AI summarizes a file (or piped input) |
| `translate` | AI translation into any language |

## sec (6 commands)

| Command | Description |
|---------|-------------|
| `cipher` | classic cipher toolbox (rot13/caesar/hex/bin) |
| `crackme` | hash cracking: challenge game + real dictionary attack |
| `entropy` | Shannon entropy analysis of text/passwords |
| `jwt` | decode & audit a JSON web token |
| `passwd` | strong password generator with entropy meter |
| `recon` | REAL domain recon: DNS + RDAP whois + HTTP header audit |

## dev (6 commands)

| Command | Description |
|---------|-------------|
| `base` | convert number bases (bin/oct/dec/hex) |
| `color` | hex ↔ rgb ↔ hsl + WCAG contrast |
| `cron` | explain a cron expression + next real run times |
| `csv` | parse CSV → aligned table or JSON (quoted fields handled) |
| `pw` | password generator (crypto-grade randomness) |
| `ts` | epoch ↔ date converter (both directions) |

---

_Total: 117 commands · regenerated 2026-09-10_
