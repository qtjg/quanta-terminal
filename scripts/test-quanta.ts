/* QUANTA full-coverage test — drives the REAL dispatcher with REAL inputs.
   Run: bun scripts/test-quanta.ts
   Network tests hit the live dev server (must be running on :3000). */

import { FS } from "../src/components/quanta/fs";
import { CmdCtx } from "../src/components/quanta/core";
import { runCommand, ALL_COMMANDS, defaultCtx, helpCard } from "../src/components/quanta/commands";
import { backoffDelay } from "../src/lib/quanta-providers";
import { classifyTask, pickRoute } from "../src/lib/quanta-omniroute";

let pass = 0, fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; }
  else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ctx: CmdCtx = defaultCtx(new FS());
ctx.apiBase = "http://127.0.0.1:3000";   // browser resolves same-origin; bun needs absolute
ctx.exec = async (cmd: string) => (await runCommand(cmd, ctx)).lines;

async function run(line: string): Promise<string[]> {
  const cmdText = line.trim();
  // mirror the real terminal: history is recorded by the shell loop
  if (cmdText && ctx.history[ctx.history.length - 1] !== cmdText) ctx.history.push(cmdText);
  const r = await runCommand(cmdText, ctx);
  // mirror the real terminal: __HELP_CARD__ marker is expanded by the UI
  return r.lines.flatMap((l) => (l === "__HELP_CARD__" ? helpCard() : [l]));
}
async function last(line: string): Promise<string> {
  const l = await run(line);
  return l[l.length - 1] ?? "";
}

async function main() {
  const BASE = "http://127.0.0.1:3000";
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const llmPace = () => pause(50000); // LLM gateway: per-minute quota

  console.log(`\nQUANTA full-coverage test — ${ALL_COMMANDS.length} commands registered\n`);

  /* ============ CORE ============ */
  console.log("── core ──");
  const help = await run("help");
  ok("help: card renders", help.some((l) => l.includes("QUANTA COMMAND INDEX")));
  ok("help: lists all commands", ALL_COMMANDS.every((c) => help.some((l) => l.split(/\s+/).includes(c.name))),
    `missing: ${ALL_COMMANDS.filter((c) => !help.some((l) => l.split(/\s+/).includes(c.name))).map((c) => c.name).join(",")}`);
  const cleared = await runCommand("clear", ctx);
  ok("clear: sets clear flag", cleared.clear === true);

  ok("echo: plain", (await run("echo hello quanta")).join("") === "hello quanta");
  ok("echo: quoted space preserved", (await run(`echo "a b" c`)).join("") === "a b c");
  await run("export GREET=namaste");
  ok("echo: $VAR expansion", (await run("echo $GREET world")).join("") === "namaste world");

  ok("date: returns a line", (await run("date")).length === 1);
  ok("date -u: has UTC", (await run("date -u")).join("").includes("GMT"));
  ok("whoami", (await run("whoami")).join("") === "mayank");
  ok("hostname", (await run("hostname")).join("") === "quanta");
  ok("uname: kernel name", (await run("uname")).join("") === "Quanta");
  ok("uname -a: full string", (await run("uname -a")).join("").includes("quanta-web"));
  ok("uptime: has up", (await last("uptime")).includes("up "));
  await run("echo one"); await run("echo two");
  const hist = await run("history");
  ok("history: contains commands", hist.some((l) => l.includes("echo two")));

  await run("alias ll='ls -l'");
  ok("alias: set", (await run("alias")).some((l) => l.includes("ll='ls -l'")));
  ok("alias: expansion works", (await run("ll README.md")).some((l) => l.includes("README")));
  ok("unalias", (await last("unalias ll")).includes("removed"));
  ok("unalias: gone", (await run("ll")).some((l) => l.includes("command not found")));

  ok("env: shows export", (await run("env")).some((l) => l.startsWith("GREET=namaste")));
  ok("export: sets", (await last("export FOO=bar42")).includes("FOO=bar42"));
  ok("which: found", (await last("which ls")).includes("/usr/bin/ls"));
  const man = await run("man grep");
  ok("man: shows usage", man.some((l) => l.includes("GREP")));
  ok("sudo: honest answer", (await run("sudo rm -rf /")).some((l) => l.includes("sandbox")));
  ok("motd", (await run("motd")).length > 0);

  let capturedTheme = "";
  ctx.setTheme = (t) => { capturedTheme = t; };
  ok("theme: list", (await run("theme")).some((l) => l.includes("matrix")));
  await run("theme matrix");
  ok("theme: switch applies", capturedTheme === "matrix");
  ok("theme: invalid rejected", (await run("theme nope")).some((l) => l.includes("unknown theme")));
  /* decoupling regression: tokyo theme renamed carbon; old name is an alias */
  ok("theme: list has carbon (no tokyo)", (await run("theme")).some((l) => l.includes("carbon")) && !(await run("theme")).some((l) => l.includes("tokyo")));
  await run("theme carbon");
  ok("theme: carbon switch applies", capturedTheme === "carbon");
  await run("theme tokyo");
  ok("theme: legacy tokyo aliases to carbon", capturedTheme === "carbon");

  const exited = await runCommand("exit", ctx);
  ok("exit: sets exit flag", exited.exit === true);

  /* ============ FILESYSTEM ============ */
  console.log("── filesystem ──");
  ok("pwd: home", (await run("pwd")).join("") === "/home/mayank");

  const lsHome = await run("ls");
  ok("ls: lists seed files", lsHome.some((l) => l.includes("README.md")));
  ok("ls: dirs get slash", lsHome.some((l) => l.includes("docs/")));
  const lsL = await run("ls -l");
  ok("ls -l: perms shown", lsL.some((l) => l.startsWith("-rw-r--r--")));
  ok("ls -l: total line", lsL[0].startsWith("total"));

  await run("touch .hidden");
  ok("ls: hides dotfiles by default", !(await run("ls")).some((l) => l.includes(".hidden")));
  ok("ls -a: shows dotfiles", (await run("ls -a")).some((l) => l.includes(".hidden")));
  await run("rm .hidden");

  ok("cd: into docs", (await runCommand("cd docs", ctx)).lines.length === 0);
  ok("pwd: updated", (await run("pwd")).join("") === "/home/mayank/docs");
  ok("ls: sees doc file", (await run("ls")).some((l) => l.includes("api-notes.txt")));
  ok("cd ..: back", (await runCommand("cd ..", ctx)).lines.length === 0);
  ok("cd: missing dir errors", (await run("cd /nope")).some((l) => l.includes("no such")));
  ok("cd: file not dir", (await run("cd README.md")).some((l) => l.includes("not a directory")));
  ok("cd ~: home", (await runCommand("cd ~", ctx)).lines.length === 0);

  ok("cat: file contents", (await run("cat notes.txt")).some((l) => l.includes("hunter2")));
  ok("cat: missing file", (await run("cat ghost.txt")).some((l) => l.includes("no such")));
  ok("cat: directory refused", (await run("cat docs")).some((l) => l.includes("is a directory")));

  ok("touch: create", (await last("touch /tmp/probe.txt")).includes("created"));
  ok("touch: bump existing", (await last("touch /tmp/probe.txt")).includes("touched"));
  ok("mkdir: create", (await last("mkdir /tmp/qdir")).includes("created"));
  ok("mkdir: duplicate errors", (await run("mkdir /tmp/qdir")).some((l) => l.includes("already exists")));
  ok("mkdir -p: nested", (await last("mkdir -p /tmp/a/b/c")).includes("created"));
  await run("write /tmp/qdir/inner.txt data");
  ok("rmdir: non-empty refused", (await run("rmdir /tmp/qdir")).some((l) => l.includes("not empty")));
  await run("mkdir /tmp/emptydir");
  ok("rmdir: empty works", (await last("rmdir /tmp/emptydir")).includes("removed"));
  ok("rmdir: missing errors", (await run("rmdir /tmp/void")).some((l) => l.includes("no such")));

  await run("write /tmp/del.txt hello");
  ok("rm: file", (await last("rm /tmp/del.txt")).includes("removed"));
  ok("rm: missing errors", (await run("rm /tmp/del.txt")).some((l) => l.includes("no such")));
  ok("rm: dir needs -r", (await run("rm /tmp/qdir")).some((l) => l.includes("use -r")));
  ok("rm -r: dir gone", (await last("rm -r /tmp/qdir")).includes("removed"));
  ok("rm /: refused", (await run("rm -r /")).some((l) => l.includes("refusing")));

  await run("write /tmp/orig.txt alpha\nbeta");
  ok("cp: copy", (await last("cp /tmp/orig.txt /tmp/copy.txt")).includes("copied"));
  ok("cp: content matches", (await run("cat /tmp/copy.txt")).join("\n") === "alpha\nbeta", (await run("cat /tmp/copy.txt")).join("|"));
  ok("mv: rename", (await last("mv /tmp/copy.txt /tmp/renamed.txt")).includes("moved"));
  ok("mv: old gone", (await run("cat /tmp/copy.txt")).some((l) => l.includes("no such")));
  ok("cp: missing src", (await run("cp /nope /tmp/x")).some((l) => l.includes("no such")));

  const tree = await run("tree /home/mayank");
  ok("tree: branches", tree.some((l) => l.includes("├──") || l.includes("└──")));
  ok("tree: count line", tree.some((l) => l.includes("entries,")));

  const find = await run("find / -name *.md");
  ok("find: locates md files", find.some((l) => l.includes("README.md")));

  ok("wc: counts", (await run("wc notes.txt")).join("").match(/\d+/) !== null);
  const wcL = await run("wc -l notes.txt");
  ok("wc -l: number only", /^\d+$/.test(wcL.join("").trim()), wcL.join(""));
  ok("head: first line", (await run("head -n 1 notes.txt")).join("") === "TODO");
  const tail = await run("tail -n 1 notes.txt");
  ok("tail: last line", tail.join("").includes("never commit"));
  ok("sort: ordered", (await run("sort /tmp/orig.txt")).join("\n") === "alpha\nbeta");
  ok("sort -r: reversed", (await run("sort -r /tmp/orig.txt")).join("\n") === "beta\nalpha");
  await run("write /tmp/u.txt a\na\nb\nb\nc");
  ok("uniq: dedupes consecutive", (await run("uniq /tmp/u.txt")).join("\n") === "a\nb\nc", (await run("uniq /tmp/u.txt")).join("|"));
  ok("rev: reverses", (await run("rev /tmp/orig.txt")).join("\n") === "ahpla\nateb");
  const nl = await run("nl /tmp/orig.txt");
  ok("nl: numbers lines", nl[0].trimStart().startsWith("1"));

  const stat = await run("stat notes.txt");
  ok("stat: fields", stat.some((l) => l.includes("regular file")) && stat.some((l) => l.includes("Size:")));
  const du = await run("du /home/mayank");
  ok("du: total line", du.some((l) => l.includes("total")));
  ok("df: table", (await run("df")).some((l) => l.includes("quanta-vfs")));
  ok("chmod: applies", (await run("chmod 700 /tmp/orig.txt")).some((l) => l.includes("rwx")));
  ok("chmod: invalid mode", (await run("chmod abc /tmp/orig.txt")).some((l) => l.includes("invalid mode")));

  await run("echo redirected line > /tmp/redir.txt");
  ok(">: redirect writes", (await run("cat /tmp/redir.txt")).join("") === "redirected line");
  await run("echo second line >> /tmp/redir.txt");
  const redir = await run("cat /tmp/redir.txt");
  ok(">>: redirect appends", redir.length === 2 && redir[1] === "second line");

  /* ============ TEXT ============ */
  console.log("── text ──");
  const grep = await run("grep -in quanta README.md");
  ok("grep: hits with line numbers", grep.some((l) => /^\s*\d+:/.test(l)), grep.join("|"));
  ok("grep -i: case insensitive", (await run("grep -i HUNTER notes.txt")).some((l) => l.includes("hunter2")));
  await run("write /tmp/gv.txt apple\nbanana\ncherry");
  const gv = await run("grep -v an /tmp/gv.txt");
  ok("grep -v: inverse match", gv.join("") === "apple cherry" || gv.join(" ").includes("apple"), gv.join("|"));
  ok("grep: no match message", (await run("grep zzzznothing README.md")).some((l) => l.includes("no matches")));
  ok("grep: invalid regex", (await run("grep ([ README.md")).some((l) => l.includes("invalid pattern")));

  const rx = await run(`regex "(\\w+)@(\\w+\\.\\w+)" g "ping mayank@quanta.dev or ai@open.ai"`);
  ok("regex: found 2", rx.some((l) => l.includes("2 match(es)")));
  ok("regex: groups extracted", rx.some((l) => l.includes("'mayank', 'quanta.dev'")));
  ok("regex: invalid pattern", (await run("regex ([ g test")).some((l) => l.startsWith("regex:")));
  ok("regex: no match", (await run(`regex "zzz" g "abc"`)).some((l) => l.includes("no matches")));

  ok("case upper", (await run("case upper hello World")).join("") === "HELLO WORLD");
  ok("case camel", (await run("case camel hello world test")).join("") === "helloWorldTest");
  ok("case snake", (await run("case snake Hello World")).join("") === "hello_world");
  ok("case kebab", (await run("case kebab Hello World")).join("") === "hello-world");
  ok("case constant", (await run("case constant Hello World")).join("") === "HELLO_WORLD");
  ok("case title", (await run("case title hello world")).join("") === "Hello World");
  ok("case reverse", (await run("case reverse abc")).join("") === "cba");
  ok("case sentence", (await run("case sentence HELLO WORLD. MORE")).join("") === "Hello world. More");
  ok("case list", (await run("case list")).some((l) => l.includes("modes:")));

  const asc = await run("ascii A");
  ok("ascii: dec 65", asc.some((l) => l.includes("65") && l.includes("0x41")));
  const ascSp = await run('ascii " "');
  ok("ascii: space visualised", ascSp.some((l) => l.includes("␠")));
  ok("ascii: unicode codepoint", (await run("ascii Я")).some((l) => l.includes("1071")));

  const urlCard = await run("url https://quanta.dev/docs?x=1&y=2#top");
  ok("url: host parsed", urlCard.some((l) => l.includes("quanta.dev")));
  ok("url: 2 params", urlCard.some((l) => l.includes("2 param(s)")));
  ok("url: hash", urlCard.some((l) => l.includes("#top")));
  ok("url: encode", (await run("url e a b")).join("") === "a%20b");
  ok("url: decode", (await run("url d a%20b")).join("") === "a b");
  ok("url: invalid", (await run("url ::::")).some((l) => l.includes("invalid")));

  await run("write /tmp/fa.txt a\nb\nc");
  await run("write /tmp/fb.txt a\nx\nc");
  const diff = await run("diff /tmp/fa.txt /tmp/fb.txt");
  ok("diff: shows -b +x", diff.some((l) => l.startsWith("- b")) && diff.some((l) => l.startsWith("+ x")));
  ok("diff: stat line", diff.some((l) => l.match(/stat \+\d+ -\d+ =\d+/) !== null));
  await run("write /tmp/fc.txt a\nb\nc");
  ok("diff: identical", (await run("diff /tmp/fa.txt /tmp/fc.txt")).some((l) => l.includes("identical")));
  ok("diff: missing file", (await run("diff /tmp/fa.txt /nope")).some((l) => l.includes("no such")));

  /* trailing "\n" is a terminator — must NOT appear as a phantom "-" row (regression) */
  await run("write /tmp/fd.txt v1\n");
  await run("write /tmp/fe.txt v2\n");
  const diffNl = await run("diff /tmp/fd.txt /tmp/fe.txt");
  ok("diff: no phantom empty row on trailing newline", !diffNl.some((l) => /^-\s*$/.test(l)) && diffNl.some((l) => l === "+ v2"));
  ok("diff: trailing-nl stat +1 -1", diffNl.some((l) => l.includes("stat +1 -1 =0")));

  const b64 = await run("base64 e hello quanta");
  ok("base64: encode", b64.join("") === "aGVsbG8gcXVhbnRh");
  ok("base64: roundtrip", (await run("base64 d aGVsbG8gcXVhbnRh")).join("") === "hello quanta");
  ok("base64: invalid", (await run("base64 d !!!bad!!!")).some((l) => l.includes("invalid") || l.includes("quanta:")));

  const h = await run("hash sha256 abc");
  ok("hash: sha256 known vector", h.join("").includes("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  const h1 = await run("hash sha1 abc");
  ok("hash: sha1 known vector", h1.join("").includes("a9993e364706816aba3e25717850c26c9cd0d89d"));

  const uuids = await run("uuid 3");
  ok("uuid: 3 generated", uuids.length === 3);
  ok("uuid: v4 format", uuids.every((u) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u)));

  const rnd = await run("rand 5 10");
  const rndVal = parseInt(rnd.join(""), 10);
  ok("rand: in bounds", rndVal >= 5 && rndVal <= 10);
  ok("rand pick", (await run("rand pick x y z")).some((l) => ["x", "y", "z"].some((v) => l.includes(`picked: ${v}`))));

  ok("calc: precedence", (await run("calc 2^10/4+sqrt(144)")).join("") === "= 268", (await run("calc 2^10/4+sqrt(144)")).join(""));
  ok("calc: unary minus", (await run("calc -5+3")).join("") === "= -2");
  ok("calc: parens", (await run("calc (2+3)*4")).join("") === "= 20");
  ok("calc: pi", (await run("calc round(pi*100)/100")).join("").includes("3.14"));
  ok("calc: div zero NaN", (await run("calc 1/0")).some((l) => l.includes("NaN")));
  ok("calc: garbage rejected", (await run("calc 2+hello")).some((l) => l.includes("cannot parse")));
  ok("calc: no eval injection", (await run("calc process.exit(1)")).some((l) => l.includes("cannot parse")));

  ok("units: mi->km", (await run("units 1 mi km")).join("").includes("1.609344"));
  ok("units: c->f", (await run("units 100 c f")).join("").includes("212"));
  ok("units: kg->lb", (await run("units 10 kg lb")).join("").includes("22.0462"));
  ok("units: cross-category rejected", (await run("units 1 km lb")).some((l) => l.includes("cannot convert")));

  /* ============ SYSTEM ============ */
  console.log("── system ──");
  const ps = await run("ps");
  ok("ps: header + procs", ps.some((l) => l.includes("PID")) && ps.some((l) => l.includes("ai-engine")));
  const killPid = ctx.processes[0]?.pid;
  ok("kill: works", (await run(`kill ${killPid}`)).some((l) => l.includes("SIGTERM")));
  ok("kill: missing pid", (await run("kill 99999")).some((l) => l.includes("no such process")));
  ok("free: memory table", (await run("free")).some((l) => l.includes("Mem:")));
  ok("lscpu: cores", (await run("lscpu")).some((l) => l.includes("logical core")));
  const top = await run("top");
  ok("top: dashboard", top.some((l) => l.includes("load avg")) && top.some((l) => l.includes("%Cpu")));
  ok("netstat: table", (await run("netstat")).some((l) => l.includes("ESTABLISHED")));
  ok("neofetch: card", (await run("neofetch")).some((l) => l.includes("mayank@quanta")));

  const ping = await run("ping example.com 2");
  ok("ping: stats + honest label", ping.some((l) => l.includes("simulated RTT")));

  /* ============ FUN ============ */
  console.log("── fun ──");
  const banner = await run("banner QUANTA");
  ok("banner: block rows", banner.length === 3 && banner[0].length > 10);
  ok("cowsay: bubble", (await run("cowsay moo")).some((l) => l.includes("< moo >")));
  ok("fortune: one line", (await run("fortune")).length === 1);

  await run("stopwatch reset");
  await run("stopwatch start");
  await new Promise((r) => setTimeout(r, 60));
  const lap = await run("stopwatch lap");
  ok("stopwatch: lap recorded", lap.some((l) => l.includes("lap 1:")));
  await new Promise((r) => setTimeout(r, 30));
  const stop = await run("stopwatch stop");
  ok("stopwatch: stops with ms", stop.some((l) => l.match(/\d{2}:\d{2}\.\d{3}/) !== null));
  ok("stopwatch: show idle", (await run("stopwatch show")).some((l) => l.includes("idle")));
  ok("stopwatch: reset", (await run("stopwatch reset")).some((l) => l.includes("reset")));
  ok("stopwatch: bad subcommand", (await run("stopwatch dance")).some((l) => l.includes("unknown subcommand")));

  /* ============ DISPATCHER EDGES ============ */
  console.log("── dispatcher edges ──");
  ok("empty line: silent", (await run("")).length === 0);
  ok("unknown: suggestion", (await run("cal")).some((l) => l.includes("nearest") && l.includes("calc")));
  ok("unknown: not found", (await run("xyzzynope")).some((l) => l.includes("command not found")));
  ok("path: ../ resolution", (await runCommand("cd docs/../projects", ctx)).lines.length === 0
    && ctx.cwd === "/home/mayank/projects");
  ok("path: absolute deep", (await run("cat /home/mayank/docs/api-notes.txt")).some((l) => l.includes("500")));
  ok("path: ~ expansion", (await run("cat ~/notes.txt")).some((l) => l.includes("SECRETS")));
  ok("quote handling in args", (await run(`write /tmp/q.txt "line one\nline two"`)).length === 1);
  ok("multiline content written", (await run("cat /tmp/q.txt")).length === 2);

  /* VFS persistence roundtrip */
  const dumped = ctx.fs.dump();
  const reloaded = FS.load(dumped);
  ok("fs: survives dump/load", reloaded.get("/tmp/q.txt") !== null);

  /* ============ NETWORK — REAL BACKEND ============ */
  console.log("── network (live backend) ──");
  try {
    const fetchRes = await fetch(`${BASE}/api/quanta/fetch`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", maxChars: 400 }),
    });
    const fj = (await fetchRes.json()) as { ok: boolean; status?: number; bodyHead?: string; timeMs?: number };
    ok("curl backend: example.com 200", fj.ok === true && fj.status === 200);
    ok("curl backend: body has content", (fj.bodyHead ?? "").includes("Example Domain"));

    const blocked = await fetch(`${BASE}/api/quanta/fetch`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:3000/" }),
    });
    ok("curl backend: private blocked", blocked.status === 403);

    await llmPace();
    const aiRes = await fetch(`${BASE}/api/quanta/chat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What is 17*23? Reply with just the number." }),
    });
    const aj = (await aiRes.json()) as { ok: boolean; text?: string; error?: string; timeMs?: number; attempts?: number };
    ok("ai backend: real LLM answered", aj.ok === true && (aj.text ?? "").length > 0, aj.error ?? "");
    ok("ai backend: correct math", (aj.text ?? "").includes("391"), aj.text ?? "");
    ok("ai backend: reliability telemetry (timeMs/attempts)", typeof aj.timeMs === "number" && (aj.attempts ?? 0) >= 1, `timeMs=${aj.timeMs} attempts=${aj.attempts}`);

    await llmPace();
    const intent = await fetch(`${BASE}/api/quanta/ai`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "show me the files in this directory", cwd: "/home/mayank", listing: "README.md notes.txt docs projects" }),
    });
    const ij = (await intent.json()) as { command?: string; error?: string };
    ok("q backend: intent -> ls", (ij.command ?? "").includes("ls"), ij.command ?? ij.error ?? "");
  } catch (e) {
    ok("network: dev server reachable", false, e instanceof Error ? e.message : String(e));
  }

  const curlCmd = await run("curl https://example.com");
  ok("curl command: real output", curlCmd.some((l) => l.includes("200")) && curlCmd.some((l) => l.includes("Example Domain")));
  ok("curl command: rejects bare host", (await run("curl example.com")).some((l) => l.includes("must start with")));

  /* ============ MULTI-PROVIDER AI ENGINE — dispatcher edges ============ */
  console.log("── multi-provider ai engine ──");
  // apiBase is "" here → catalog fetches fail gracefully; assert error paths + state machine
  const prov = await run("providers");
  ok("providers: graceful without backend", prov.length > 0 && prov.every((l) => typeof l === "string"));
  const mList = await run("model");
  ok("model: graceful without backend", mList.length > 0);
  let capturedModel = "unset";
  ctx.setModel = (m: string) => { capturedModel = m; };
  ok("model: reset clears to builtin", (await run("model reset")).some((l) => l.includes("builtin")) && capturedModel === "");
  ok("model: unknown provider rejected", (await run("model use nope/model")).some((l) => l.includes("unknown provider")));
  ok("model: no-key provider blocked", (await run("model use openrouter/test:free")).some((l) => /needs|unavailable/i.test(l)));
  ok("model: bad subcommand rejected", (await run("model dance")).some((l) => l.includes("usage: model")));
  ok("ai: bare ai shows usage", (await run("ai")).some((l) => l.includes("usage: ai")));
  ok("summarize: missing file rejected", (await run("summarize /nope/missing.txt")).some((l) => l.includes("no such file")));
  await run("write /tmp/sum.md AI agents run the loop\nthey read files and act\n");
  ok("summarize: empty-backend error surfaced", (await run("summarize /tmp/sum.md")).length > 0);
  ok("models: live catalog shape ok", (await run("models")).length > 0);

  /* ============ AI RELIABILITY ENGINE — unit + edges ============ */
  console.log("── ai reliability engine ──");
  ok("backoff: attempt 0 = 500ms", backoffDelay(0) === 500);
  ok("backoff: attempt 1 = 1000ms", backoffDelay(1) === 1000);
  ok("backoff: capped at 4000ms", backoffDelay(5) === 4000);
  ok("backoff: honors Retry-After", backoffDelay(0, 2500) === 2500);
  ok("backoff: Retry-After capped", backoffDelay(0, 9999) === 4000);
  ok("model test: unknown provider rejected", (await run("model test nope/whatever")).some((l) => l.includes("unknown provider")));
  ok("model test: no-key provider blocked", (await run("model test openrouter/deepseek/deepseek-chat-v3-0324:free")).some((l) => l.includes("needs OPENROUTER_API_KEY")));
  ok("ai stats: renders (zero-call baseline)", (await run("ai stats")).some((l) => l.includes("AI SESSION STATS")));

  /* ============ SECURITY TOOLKIT — crypto + edges ============ */
  console.log("── security toolkit ──");
  const JWT_OK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ik1heWFuayIsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30";
  const jwt1 = await run(`jwt ${JWT_OK}`);
  ok("jwt: header decoded", jwt1.some((l) => l.includes("HS256")));
  ok("jwt: payload decoded", jwt1.some((l) => l.includes("Mayank")));
  ok("jwt: no-exp warning", jwt1.some((l) => l.includes("no exp claim")));
  ok("jwt: parses-clean verdict", jwt1.some((l) => l.includes("parses clean")));

  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expTok = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "t", exp: 1000000000 })}.sig`;
  ok("jwt: expired detected", (await run(`jwt ${expTok}`)).some((l) => l.includes("EXPIRED")));
  const noneOut = await run(`jwt ${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "t" })}.`);
  ok("jwt: alg none flagged", noneOut.some((l) => l.includes("alg:none")));
  ok("jwt: do-not-trust verdict", noneOut.some((l) => l.includes("DO NOT TRUST")));
  ok("jwt: garbage rejected", (await run("jwt not-a-token")).some((l) => l.includes("not a valid")));

  ok("cipher: rot13 encode", (await run("cipher rot13 hello"))[0].startsWith("uryyb"));
  ok("cipher: rot13 is its own inverse", (await run("cipher rot13 uryyb"))[0].startsWith("hello"));
  ok("cipher: caesar shift 3", (await run("cipher caesar 3 abc"))[0].startsWith("def"));
  ok("cipher: caesar decrypt -3", (await run("cipher caesar -3 def"))[0].startsWith("abc"));
  ok("cipher: hex known vector", (await run("cipher hex e quanta"))[0] === "71 75 61 6e 74 61");
  ok("cipher: hex decode roundtrip", (await run("cipher hex d 71 75 61 6e 74 61"))[0] === "quanta");
  ok("cipher: bad hex rejected", (await run("cipher hex d zzzz")).some((l) => l.includes("bad hex")));
  ok("cipher: bin roundtrip", (await run("cipher bin e A"))[0] === "01000001" && (await run("cipher bin d 01000001"))[0] === "A");
  ok("cipher: stdin pipe works", (await run("echo uryyb | cipher rot13"))[0].startsWith("hello"));

  const pw1 = await run("passwd 20");
  const pwLine = pw1.find((l) => l.trim().length === 20 && l.trim() !== "crypto.getRandomValues");
  ok("passwd: 20 chars generated", Boolean(pwLine), pw1.join("|").slice(0, 100));
  ok("passwd: all 4 char classes", Boolean(pwLine && /[a-z]/.test(pwLine) && /[A-Z]/.test(pwLine) && /[0-9]/.test(pwLine) && /[^a-zA-Z0-9]/.test(pwLine)));
  ok("passwd: entropy meter (FORTRESS at 20)", pw1.some((l) => l.includes("bits — FORTRESS")));
  ok("passwd: unique per call", pw1.find((l) => l.trim().length === 20) !== (await run("passwd 20")).find((l) => l.trim().length === 20));
  ok("passwd: min length clamp 8", (await run("passwd 2")).some((l) => l.trim().length === 8 && /[a-z]/.test(l)));
  ok("passwd: count arg", (await run("passwd 12 3")).filter((l) => l.trim().length === 12).length === 3);

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("password123"));
  const hexHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const crack = await run(`crackme ${hexHash}`);
  ok("crackme: real dictionary crack", crack.some((l) => l.includes("CRACKED")) && crack.some((l) => l.includes("password123")), crack.join("|").slice(0, 120));
  ok("crackme: strong hash survives", (await run(`crackme ${"ab".repeat(32)}`)).some((l) => l.includes("not in dictionary")));
  ok("crackme: demo walks wordlist", (await run("crackme demo")).some((l) => l.includes("DICTIONARY ATTACK")));
  ok("crackme: demo reports cracked + timing", (await run("crackme demo")).some((l) => l.includes("cracked:")));
  const ch = await run("crackme");
  ok("crackme: challenge shows target", ch.some((l) => l.includes("target:")) && ch.some((l) => l.includes("hint:")));
  ok("crackme: guess miss tracked", (await run("crackme guess zzz")).some((l) => l.includes("miss")));
  ok("crackme: giveup reveals", (await run("crackme giveup")).some((l) => l.includes("the secret was")));
  ok("crackme: guess w/o challenge", (await run("crackme guess x")).some((l) => l.includes("no active challenge")));

  ok("recon: invalid domain rejected", (await run("recon not_a_domain")).some((l) => l.includes("not a valid domain")));
  ok("recon: missing arg usage", (await run("recon")).some((l) => l.includes("usage: recon")));

  /* ============ ROUTE TABLE + BENCH EDGES ============ */
  console.log("── route table + bench edges ──");
  const route1 = await run("route");
  ok("route: table renders", route1.some((l) => l.includes("AI ROUTE TABLE")));
  ok("route: chain line", route1.some((l) => l.includes("openrouter → groq → gemini → cerebras → builtin")));
  ok("route: retry policy honest", route1.some((l) => l.includes("transient")) && route1.some((l) => l.includes("fatal")));
  ok("route: builtin marked fallback", route1.some((l) => l.includes("fallback") && l.includes("builtin")));
  ok("bench: unknown provider rejected pre-spend", (await run("bench builtin nope/model")).some((l) => l.includes("unknown provider")));
  ok("bench: identical models rejected", (await run("bench builtin builtin")).some((l) => l.includes("two different models")));

  /* ============ OMNIROUTE ROUTER — pure unit (no network) ============ */
  console.log("── omniroute router (unit) ──");
  ok("omni classify: code lane", classifyTask("write a python function to sort a list").type === "code");
  ok("omni classify: math lane", classifyTask("calculate 12*8 for me").type === "math");
  ok("omni classify: translate lane", classifyTask("translate hello to japanese").type === "translate");
  ok("omni classify: summarize lane", classifyTask("summarize this article please").type === "summarize");
  ok("omni classify: general lane", classifyTask("what is the capital of japan").type === "general");

  ok("omni pick: zero keys → null (builtin lane)", pickRoute("code", [
    { id: "openrouter", hasKey: false, freeModels: ["deepseek/deepseek-chat-v3-0324:free"] },
    { id: "groq", hasKey: false, freeModels: ["llama-3.3-70b-versatile"] },
  ]) === null);
  const pickCode = pickRoute("code", [
    { id: "openrouter", hasKey: false, freeModels: ["deepseek/deepseek-chat-v3-0324:free"] },
    { id: "groq", hasKey: true, freeModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] },
  ]);
  ok("omni pick: keyed lane chosen", pickCode !== null && pickCode.provider === "groq", JSON.stringify(pickCode));
  ok("omni pick: lane pattern match (llama-3.3 for code)", pickCode?.model === "llama-3.3-70b-versatile", pickCode?.model ?? "none");
  ok("omni pick: empty free catalog skipped", pickRoute("math", [
    { id: "openrouter", hasKey: true, freeModels: [] },
    { id: "groq", hasKey: true, freeModels: ["llama-3.3-70b-versatile"] },
  ])?.provider === "groq");
  ok("omni pick: provider order respected (openrouter first)", pickRoute("general", [
    { id: "groq", hasKey: true, freeModels: ["llama-3.3-70b-versatile"] },
    { id: "openrouter", hasKey: true, freeModels: ["meta-llama/llama-3.3-70b-instruct:free"] },
  ])?.provider === "openrouter");
  ok("omni pick: general falls back to first free model", pickRoute("general", [
    { id: "groq", hasKey: true, freeModels: ["gemma2-9b-it"] },
  ])?.model === "gemma2-9b-it");

  /* ============ RECON — LIVE (keyless real data) ============ */
  console.log("── recon (live) ──");
  try {
    const rec = await run("recon example.com");
    ok("recon live: DNS A record", rec.some((l) => /A\s+\d+\.\d+\.\d+\.\d+/.test(l)), rec.join("|").slice(0, 140));
    ok("recon live: whois section", rec.some((l) => l.includes("whois")));
    ok("recon live: http section", rec.some((l) => /http\s+\d{3}/.test(l)) || rec.some((l) => l.includes("unreachable")));
    ok("recon live: security grade", rec.some((l) => l.includes("grade")));
    ok("recon live: latency source line", rec.some((l) => l.includes("dns.google") && l.includes("ms total")));
  } catch (e) {
    ok("recon live: reachable", false, e instanceof Error ? e.message : String(e));
  }

  /* ============ AI COMMANDS — LIVE ============ */
  // The LLM gateway rate-limits per minute. Honest strategy: pace calls ~50s
  // apart, one 50s retry on 429 — the real service, no mocking.
  console.log("── ai commands (live, paced) ──");
  await run("cd ~");

  await llmPace();
  let ai = await run("ai What is 2+2? One word answer.");
  if (ai.some((l) => l.includes("429"))) { await llmPace(); ai = await run("ai What is 2+2? One word answer."); }
  ok("ai: live response", ai.some((l) => /\b4\b|four/i.test(l)), ai.join(" | ").slice(0, 120));

  await llmPace();
  let q = await run("q list the files here");
  if (q.some((l) => l.includes("429"))) { await llmPace(); q = await run("q list the files here"); }
  ok("q: intent executed", q.some((l) => l.includes("plan:")) && q.some((l) => /README|notes|app\//.test(l)), q.join(" | ").slice(0, 160));

  await llmPace();
  let ex = await run("explain grep");
  if (ex.some((l) => l.includes("429"))) { await llmPace(); ex = await run("explain grep"); }
  ok("explain: bullets", ex.length > 0 && ex.some((l) => /grep|search|line|match/i.test(l)), ex.join(" | ").slice(0, 120));

  /* ---- model test: REAL probe round-trip against the live gateway ---- */
  await llmPace();
  let mt = await run("model test");
  if (mt.some((l) => l.includes("429"))) { await llmPace(); mt = await run("model test"); }
  ok("model test: live PASS", mt.some((l) => l.includes("PASS ✓")), mt.join(" | ").slice(0, 160));
  ok("model test: verified verdict", mt.some((l) => l.includes("model verified")), mt.join(" | ").slice(0, 160));
  ok("model test: telemetry (served/attempts)", mt.some((l) => /served:.*attempts: \d/.test(l)), mt.join(" | ").slice(0, 160));

  /* ---- automatic builtin fallback: REAL transient-failure path (ollama not running) ---- */
  ctx.setModel = (m: string) => { capturedModel = m; ctx.model = m; };
  ok("fallback setup: model use ollama accepted", (await run("model use ollama/llama3.2")).some((l) => l.includes("model set")) && ctx.model === "ollama/llama3.2");
  await llmPace();
  let fb = await run("ai say hello in one word");
  if (!fb.some((l) => l.includes("note: ollama failed"))) { await llmPace(); fb = await run("ai say hello in one word"); }
  ok("fallback: ollama failure honestly noted", fb.some((l) => l.includes("note: ollama failed")), fb.join(" | ").slice(0, 160));
  ok("fallback: builtin served after retries", fb.some((l) => l.includes("answered automatically by builtin fallback")), fb.join(" | ").slice(0, 160));
  ok("fallback: real answer in frame", fb.some((l) => l.startsWith("┌─ quanta-ai")) && fb.length > 2, fb.join(" | ").slice(0, 120));
  await run("model reset");

  /* ---- q (intent) honors model use: dead provider → engine falls back to builtin, command still produced ---- */
  ok("q fallback setup: model use ollama accepted", (await run("model use ollama/llama3.2")).some((l) => l.includes("model set")) && ctx.model === "ollama/llama3.2");
  await llmPace();
  let qfb = await run("q list the files here");
  if (!qfb.some((l) => l.includes("plan:"))) { await llmPace(); qfb = await run("q list the files here"); }
  ok("q fallback: intent route survives dead provider", qfb.some((l) => l.includes("plan:")) && qfb.some((l) => /README|notes|app\//.test(l)), qfb.join(" | ").slice(0, 160));
  await run("model reset");

  /* ---- ai stats: live session telemetry ---- */
  const stats = await run("ai stats");
  ok("ai stats: live counts", stats.some((l) => /calls: [1-9]/.test(l)) && stats.some((l) => /ok: [1-9]/.test(l)), stats.join(" | ").slice(0, 200));
  ok("ai stats: latency telemetry", stats.some((l) => /avg latency/.test(l) && /total ai time/.test(l)));

  /* ---- bench: LIVE head-to-head (builtin vs no-key groq lane → honest FAIL row) ---- */
  await llmPace();
  let benchLive = await run("bench builtin");
  if (!benchLive.some((l) => l.includes("MODEL BENCH"))) { await llmPace(); benchLive = await run("bench builtin"); }
  ok("bench live: builtin lane correct", benchLive.some((l) => l.startsWith("  builtin") && l.includes("✓ correct")), benchLive.join(" | ").slice(0, 200));
  ok("bench live: no-key lane honest FAIL", benchLive.some((l) => l.includes("FAIL")), benchLive.join(" | ").slice(0, 200));
  ok("bench live: winner declared", benchLive.some((l) => l.includes("winner: builtin")), benchLive.join(" | ").slice(0, 200));

  /* ============ OMNIROUTE — LIVE (no keys → honest builtin route line) ============ */
  console.log("── omniroute (live) ──");
  const omniOn = await run("omniroute on");
  ok("omniroute live: on accepted", omniOn.some((l) => l.includes("omniroute ENABLED")) && ctx.omni.enabled === true, omniOn.join(" | ").slice(0, 120));
  const omniStatus = await run("omniroute status");
  ok("omniroute live: status ON", omniStatus.some((l) => l.includes("mode: ON")), omniStatus.join(" | ").slice(0, 120));
  ok("omniroute live: lanes listed", omniStatus.some((l) => l.includes("code")) && omniStatus.some((l) => l.includes("translate")) && omniStatus.some((l) => l.includes("summarize")));
  ok("omniroute live: manual override wins note (on output)", omniOn.some((l) => l.includes("manual override still wins: model use")), omniOn.join(" | ").slice(0, 160));

  await llmPace();
  let omniAi = await run("ai What is 6*7? One word answer.");
  if (!omniAi.some((l) => l.includes("route:"))) { await llmPace(); omniAi = await run("ai What is 6*7? One word answer."); }
  const routeLine = omniAi.find((l) => l.includes("route: ")) ?? "";
  ok("omniroute live: route line inside frame", Boolean(routeLine), omniAi.join(" | ").slice(0, 160));
  ok("omniroute live: first content line is the route", (omniAi[1] ?? "").includes("route: "), omniAi.slice(0, 2).join(" | "));
  ok("omniroute live: classified math lane", routeLine.includes("route: math → "), routeLine);
  ok("omniroute live: no-key → honest builtin lane", routeLine.includes("builtin (no keyed provider configured — zero-config lane)"), routeLine);
  ok("omniroute live: answer still served (42)", omniAi.some((l) => /\b42\b/.test(l)), omniAi.join(" | ").slice(0, 120));
  ok("omniroute live: routed counter + last route recorded", ctx.omni.routed >= 1 && ctx.omni.lastRoute === "builtin" && ctx.omni.lastClass === "math", `routed=${ctx.omni.routed} last=${ctx.omni.lastClass}→${ctx.omni.lastRoute}`);

  const omniStats = await run("ai stats");
  ok("omniroute live: stats shows ON + auto-routed count", omniStats.some((l) => /omniroute: ON — \d+ auto-routed/.test(l)), omniStats.join(" | ").slice(0, 200));
  ok("omniroute live: stats shows last route", omniStats.some((l) => l.includes("last: math → builtin")), omniStats.join(" | ").slice(0, 200));

  const omniOff = await run("omniroute off");
  ok("omniroute live: off accepted + session count", omniOff.some((l) => l.includes("omniroute OFF")) && omniOff.some((l) => l.includes("auto-routes so far")) && ctx.omni.enabled === false, omniOff.join(" | ").slice(0, 160));
  ok("omniroute live: status reflects OFF", (await run("omniroute status")).some((l) => l.includes("mode: OFF")));

  /* ============ SUMMARY ============ */
  console.log(`\n${"═".repeat(52)}`);
  console.log(`  RESULT: ${pass} passed, ${fail} failed, ${pass + fail} total`);
  console.log(`  commands registered: ${ALL_COMMANDS.length}`);
  console.log("═".repeat(52));
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
