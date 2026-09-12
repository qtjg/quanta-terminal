/* QUANTA text-processing commands: grep regex case ascii url diff base64
   hash uuid rand calc units */

import { CmdCtx, CmdDef, err, absPath, contentLines, hasStdin, stdinLines } from "./core";
import { isFile } from "./fs";
import {
  parseFlags, regexLines, caseTransform, CASE_MODES, CaseMode, asciiTable,
  urlInfo, diffText, diffStat, b64encode, b64decode, shaHex, uuidV4,
  calcEval, convert, padCell, jsonParseChecked, jsonType, jsonGet, slugify, wordFreq, alignLine, loremIpsum, expandTabs, wrapText, shuffled, primeFactors, levenshtein,
} from "./text-tools";

/** load file content or treat trailing string arg as inline subject */
function subject(ctx: CmdCtx): { text: string; from: string } {
  const p = absPath(ctx, ctx.args[ctx.args.length - 1]);
  const node = ctx.fs.get(p);
  if (node && isFile(node)) return { text: node.content, from: ctx.args[ctx.args.length - 1] };
  const last = ctx.args[ctx.args.length - 1] ?? "";
  return { text: last, from: "(inline)" };
}

export const TEXT_COMMANDS: CmdDef[] = [
  {
    name: "grep", cat: "text", desc: "search text (file, pipe or inline)", usage: "grep [-i] [-n] [-v] <pattern> [file]  ·  … | grep <pat>",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      if (!pos.length) return err("usage: grep [-i|-n|-v] <pattern> [file]");
      const pattern = pos[0];
      let text: string, from: string;
      if (pos[1]) {
        const node = ctx.fs.get(absPath(ctx, pos[1]));
        if (!node || !isFile(node)) return err(`grep: ${pos[1]}: no such file`);
        text = node.content; from = pos[1];
      } else if (hasStdin(ctx)) {
        text = ctx.stdin as string; from = "(stdin)";
      } else {
        const s = subject(ctx);
        text = s.text; from = s.from;
      }
      let re: RegExp;
      try {
        re = new RegExp(pattern, flags.has("i") ? "i" : "");
      } catch {
        return err(`grep: invalid pattern '${pattern}'`);
      }
      const lines = contentLines(text);
      const out: string[] = [];
      lines.forEach((l, i) => {
        const hit = flags.has("v") ? !re.test(l) : re.test(l);
        if (hit) out.push(flags.has("n") ? `${String(i + 1).padStart(4)}: ${l}` : l);
      });
      if (!out.length) return [ `(no ${flags.has("v") ? "non-" : ""}matches in ${from})`];
      return out;
    },
  },
  {
    name: "regex", cat: "text", desc: "regex tester: matches + groups", usage: 'regex <pattern> [flags g/i/m] "<subject>"',
    run: (ctx) => {
      if (ctx.args.length < 2) return err(`usage: regex <pattern> <flags> "<subject>"`);
      const pattern = ctx.args[0];
      const flagStr = ctx.args[1].replace(/[^gimsuy]/g, "");
      const subjectStr = ctx.args.slice(2).join(" ");
      if (!subjectStr) return err("regex: empty subject");
      const res = regexLines(pattern, flagStr, subjectStr);
      if (!res.ok) return [ `regex: ${res.error}` ];
      if (!res.hits.length) return [ "no matches", `pattern /${pattern}/${flagStr}` ];
      const out = [`pattern /${pattern}/${flagStr} — ${res.total} match(es)`];
      for (const hit of res.hits) {
        for (const m of hit.matches) {
          const groups = m.groups.length ? `  groups:[${m.groups.map((g) => `'${g}'`).join(", ")}]` : "";
          out.push(`line ${hit.line} @${m.index}: '${m.text}'${groups}`);
        }
      }
      return out;
    },
  },
  {
    name: "case", cat: "text", desc: "11 case transforms", usage: "case <mode> <text>",
    run: (ctx) => {
      if (!ctx.args.length || ctx.args[0] === "list") {
        return [`modes: ${CASE_MODES.join(" / ")}`, `usage: case <mode> "<text>"`];
      }
      const mode = ctx.args[0] as CaseMode;
      if (!CASE_MODES.includes(mode)) return err(`unknown mode '${ctx.args[0]}' — try 'case list'`);
      const text = ctx.args.slice(1).join(" ");
      if (!text) return err("case: empty input");
      return [ caseTransform(mode, text) ];
    },
  },
  {
    name: "ascii", cat: "text", desc: "ascii/unicode code table", usage: 'ascii <text>',
    run: (ctx) => {
      const text = ctx.args.join(" ");
      if (!text) return err("usage: ascii <text>");
      const rows = asciiTable(text);
      const out = [ `${padCell("char", 6)}${padCell("dec", 7)}${padCell("hex", 7)}bin        utf-8` ];
      for (const r of rows) {
        out.push(`${padCell(r.ch, 6)}${padCell(String(r.dec), 7)}${padCell(r.hex, 7)}${r.bin}  ${r.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
      }
      return out;
    },
  },
  {
    name: "url", cat: "text", desc: "url parser + enc/dec", usage: "url <url>  |  url e|d <text>",
    run: (ctx) => {
      if (!ctx.args.length) return err("usage: url <url> | url e|d <text>");
      const mode = ctx.args[0];
      if (mode === "e") return [ encodeURIComponent(ctx.args.slice(1).join(" ")) ];
      if (mode === "d") {
        try { return [ decodeURIComponent(ctx.args.slice(1).join(" ")) ]; }
        catch { return err("url: malformed percent-encoding"); }
      }
      const res = urlInfo(ctx.args[0]);
      return res.ok ? res.card : err(res.error);
    },
  },
  {
    name: "diff", cat: "text", desc: "side-by-side diff of two files (LCS)", usage: "diff <fileA> <fileB>  ·  --raw for plain text",
    run: (ctx) => {
      const { pos, flags } = parseFlags(ctx.args);
      if (pos.length < 2) return err("usage: diff <fileA> <fileB>  (--raw for plain text)");
      const [aName, bName] = pos;
      const nodes = [aName, bName].map((a) => ctx.fs.get(absPath(ctx, a)));
      if (!nodes[0] || !nodes[1]) return err(`diff: ${!nodes[0] ? aName : bName}: no such file`);
      if (!isFile(nodes[0]) || !isFile(nodes[1])) return err("diff: both operands must be files");
      const rows = diffText(nodes[0].content, nodes[1].content);
      const stat = diffStat(rows);
      /* visual side-by-side viewer when an interactive panel surface exists */
      if (ctx.openPanel && !hasStdin(ctx) && !flags.has("raw")) {
        ctx.openPanel({ type: "diff", aName, bName, rows, stat });
        return [`→ diff opened in viewer — ${aName} → ${bName} ${stat} (esc to close · --raw for text)`];
      }
      const out = [ `--- ${aName}`, `+++ ${bName}`, `stat ${stat}`, "" ];
      for (const r of rows.slice(0, 120)) out.push(`${r.op} ${r.line}`);
      if (rows.length > 120) out.push(`… ${rows.length - 120} more rows`);
      if (rows.length && rows.every((r) => r.op === "=")) out.push("(files identical)");
      return out;
    },
  },
  {
    name: "base64", cat: "text", desc: "base64 encode/decode", usage: "base64 e|d <text>",
    run: (ctx) => {
      const mode = ctx.args[0];
      const text = ctx.args.slice(1).join(" ");
      if (!mode || !text) return err("usage: base64 e|d <text>");
      try {
        return [ mode === "e" ? b64encode(text) : b64decode(text) ];
      } catch {
        return err("base64: invalid input");
      }
    },
  },
  {
    name: "hash", cat: "text", desc: "sha-1/256/384/512 of text", usage: "hash [sha256] <text>",
    run: async (ctx) => {
      const ALGOS = ["sha1", "sha256", "sha384", "sha512"];
      const first = (ctx.args[0] ?? "").toLowerCase();
      const isAlgoToken = ALGOS.includes(first);
      const algo = (isAlgoToken
        ? "SHA-" + first.slice(3)
        : "SHA-256") as "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
      const text = (isAlgoToken ? ctx.args.slice(1) : ctx.args).join(" ");
      if (!text) return err("usage: hash [sha1|sha256|sha384|sha512] <text>");
      const hex = await shaHex(algo, text);
      return [ `${algo}: ${hex}` ];
    },
  },
  {
    name: "uuid", cat: "text", desc: "generate uuid v4", usage: "uuid [count]",
    run: (ctx) => {
      const count = Math.min(Math.max(parseInt(ctx.args[0] ?? "1", 10) || 1, 1), 20);
      return Array.from({ length: count }, () => uuidV4());
    },
  },
  {
    name: "rand", cat: "text", desc: "random int / pick from list", usage: "rand [min max] | rand pick a b c...",
    run: (ctx) => {
      if (ctx.args[0] === "pick") {
        const items = ctx.args.slice(1);
        if (items.length < 2) return err("rand pick needs 2+ items");
        return [ `picked: ${items[Math.floor(Math.random() * items.length)]}` ];
      }
      const min = parseInt(ctx.args[0] ?? "1", 10) || 1;
      const max = parseInt(ctx.args[1] ?? "100", 10) || 100;
      return [ String(Math.floor(Math.random() * (max - min + 1)) + min) ];
    },
  },
  {
    name: "calc", cat: "text", desc: "safe calculator (no eval)", usage: 'calc <expr>   e.g. calc 2^10/4 + sqrt(144)',
    run: (ctx) => {
      const expr = ctx.args.join(" ");
      if (!expr) return err("usage: calc <expression>");
      const val = calcEval(expr);
      if (val === null) return err(`calc: cannot parse '${expr}'`);
      if (Number.isNaN(val)) return [ "result: NaN (division by zero?)" ];
      return [ `= ${val}` ];
    },
  },
  {
    name: "json", cat: "text", desc: "JSON toolkit — validate, pretty, keys, get, type", usage: 'json [-c] [keys | get <dot.path> | type <dot.path>] <file>  ·  echo \'…\' | json',
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      const MODES = ["keys", "get", "type"];
      const mode = MODES.includes(pos[0] ?? "") ? (pos[0] as string) : "";
      const rest = mode ? pos.slice(1) : pos;
      let path = "";
      let subjectParts = rest;
      if (mode === "get" || mode === "type") {
        if (!rest.length) return err(`usage: json ${mode} <dot.path> <file>  ·  … | json ${mode} <dot.path>`);
        path = rest[0];
        subjectParts = rest.slice(1);
      }
      let text = "";
      let from = "";
      if (hasStdin(ctx)) {
        text = (ctx.stdin ?? "");
        from = "(stdin)";
      } else if (subjectParts.length) {
        const lastTok = subjectParts[subjectParts.length - 1];
        const node = ctx.fs.get(absPath(ctx, lastTok));
        if (node && isFile(node)) {
          text = node.content;
          from = lastTok;
        } else {
          text = subjectParts.join(" ");
          from = "(inline)";
        }
      }
      if (!text.trim()) return err("usage: json [keys|get <path>|type <path>] <file>  ·  echo '…' | json");
      const parsed = jsonParseChecked(text);
      if (!parsed.ok) return err(`json: invalid JSON — ${parsed.error}`);
      const v = parsed.value;
      if (mode === "keys") {
        if (Array.isArray(v)) return [`array[${v.length}] — numeric indices 0..${Math.max(v.length - 1, 0)}`];
        if (v !== null && typeof v === "object") {
          const rec = v as Record<string, unknown>;
          const out = Object.entries(rec).map(([k, val]) => `  ${k}: ${jsonType(val)}`);
          return [`${Object.keys(rec).length} top-level key(s) in ${from}`, ...out];
        }
        return err(`json keys: subject is ${jsonType(v)}, not an object/array`);
      }
      if (mode === "get" || mode === "type") {
        const r = jsonGet(v, path);
        if (!r.ok) return err(`json get: ${r.error}`);
        if (mode === "type") return [`${path || "/"} → ${jsonType(r.value)}`];
        const rendered = typeof r.value === "string" ? r.value : JSON.stringify(r.value, null, 2);
        return [`${path || "/"} = (${jsonType(r.value)})`, ...rendered.split("\n")];
      }
      const out = flags.has("c") ? JSON.stringify(v) : JSON.stringify(v, null, 2);
      return [`${from}: valid JSON, ${jsonType(v)}, ${text.length} bytes`, ...out.split("\n")];
    },
  },
  {
    name: "slug", cat: "text", desc: "slugify text → URL-safe identifier", usage: 'slug <text> [separator]  ·  echo "…" | slug',
    run: (ctx) => {
      const last = ctx.args[ctx.args.length - 1] ?? "";
      const usep = ["-", "_", "."].includes(last) ? last : "-";
      let text = usep === last ? ctx.args.slice(0, -1).join(" ") : ctx.args.join(" ");
      if (!text.trim() && hasStdin(ctx)) text = ctx.stdin ?? "";
      if (!text.trim()) return err("usage: slug <text> [separator]  ·  echo '…' | slug");
      return [slugify(text, usep) || "(empty slug)"];
    },
  },
  {
    name: "wordfreq", cat: "text", desc: "word frequency table (-s skips stop words)", usage: "wordfreq [-s] [-n N] <file>  ·  … | wordfreq",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      let n = 10;
      let fileParts = pos;
      if (flags.has("n") && pos.length >= 2 && /^\d+$/.test(pos[0])) {
        n = Math.min(Math.max(parseInt(pos[0], 10), 1), 50);
        fileParts = pos.slice(1);
      }
      let text = "";
      let from = "";
      if (hasStdin(ctx)) {
        text = ctx.stdin ?? "";
        from = "(stdin)";
      } else if (fileParts.length) {
        const node = ctx.fs.get(absPath(ctx, fileParts[0]));
        if (!node || !isFile(node)) return err(`wordfreq: ${fileParts[0]}: no such file`);
        text = node.content;
        from = fileParts[0];
      } else {
        return err("usage: wordfreq [-s] [-n N] <file>  ·  … | wordfreq");
      }
      const freq = wordFreq(text, flags.has("s"));
      const total = freq.reduce((s, [, c]) => s + c, 0);
      if (!total) return [`no words found in ${from}`];
      const width = String(freq[0][1]).length;
      const out = [
        `top ${Math.min(n, freq.length)} of ${freq.length} unique words (${total} total)${flags.has("s") ? " · stop words skipped" : ""}`,
      ];
      for (const [w, c] of freq.slice(0, n)) {
        const bar = "█".repeat(Math.max(1, Math.round((c / freq[0][1]) * 12)));
        out.push(`  ${String(c).padStart(width)}  ${padCell(w, 14)} ${bar}`);
      }
      return out;
    },
  },
  {
    name: "pad", cat: "text", desc: "align text left/right/center to width", usage: 'pad <l|r|c> <width> <text>  ·  … | pad c 40',
    run: (ctx) => {
      const MODES: Record<string, "left" | "right" | "center"> = { l: "left", r: "right", c: "center", left: "left", right: "right", center: "center" };
      const mode = MODES[ctx.args[0] ?? ""];
      const width = parseInt(ctx.args[1] ?? "", 10);
      if (!mode || !width) return err("usage: pad <l|r|c> <width> <text>  ·  … | pad c 40");
      let lines: string[];
      if (hasStdin(ctx)) {
        lines = stdinLines(ctx);
      } else {
        const text = ctx.args.slice(2).join(" ");
        if (!text) return err("usage: pad <l|r|c> <width> <text>");
        lines = [text];
      }
      return lines.map((l) => alignLine(l, width, mode));
    },
  },
  {
    name: "lorem", cat: "text", desc: "lorem ipsum filler text generator", usage: "lorem [paragraphs 1-8]",
    run: (ctx) => {
      const n = Math.max(1, Math.min(parseInt(ctx.args[0] ?? "2", 10) || 2, 8));
      return loremIpsum(n).flatMap((p) => [p, ""]).slice(0, -1);
    },
  },
  {
    name: "expand", cat: "text", desc: "expand tabs to spaces (tab stops)", usage: "expand [-w width] <file>  ·  … | expand",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      const width = flags.has("w") && pos.length >= 2 && /^\d+$/.test(pos[0]) ? Math.max(1, parseInt(pos[0], 10)) : 4;
      const fileTok = flags.has("w") && /^\d+$/.test(pos[0] ?? "") ? pos[1] : pos[0];
      let text = "";
      let from = "";
      if (hasStdin(ctx)) {
        text = ctx.stdin ?? "";
        from = "(stdin)";
      } else if (fileTok) {
        const node = ctx.fs.get(absPath(ctx, fileTok));
        if (!node || !isFile(node)) return err(`expand: ${fileTok}: no such file`);
        text = node.content;
        from = fileTok;
      } else {
        return err("usage: expand [-w width] <file>  ·  … | expand");
      }
      const out = expandTabs(text, width);
      return [`${from} → tabs expanded (width ${width})`, ...out.split("\n")];
    },
  },
  {
    name: "fold", cat: "text", desc: "wrap each line at width", usage: "fold [-w width] <file>  ·  … | fold",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      const width = flags.has("w") && pos.length >= 2 && /^\d+$/.test(pos[0]) ? Math.max(10, parseInt(pos[0], 10)) : 80;
      const fileTok = flags.has("w") && /^\d+$/.test(pos[0] ?? "") ? pos[1] : pos[0];
      let text = "";
      let from = "";
      if (hasStdin(ctx)) {
        text = ctx.stdin ?? "";
        from = "(stdin)";
      } else if (fileTok) {
        const node = ctx.fs.get(absPath(ctx, fileTok));
        if (!node || !isFile(node)) return err(`fold: ${fileTok}: no such file`);
        text = node.content;
        from = fileTok;
      } else {
        return err("usage: fold [-w width] <file>  ·  … | fold");
      }
      const out = wrapText(text, width);
      return [`${from} → wrapped at ${width}`, ...out];
    },
  },
  {
    name: "shuf", cat: "text", desc: "shuffle lines (file, pipe or list)", usage: "shuf <file>  ·  … | shuf  ·  shuf -e a b c",
    run: (ctx) => {
      const { flags, pos } = parseFlags(ctx.args);
      let lines: string[];
      let from = "";
      if (flags.has("e")) {
        if (pos.length < 2) return err("shuf -e needs 2+ items");
        lines = pos;
        from = "(items)";
      } else if (hasStdin(ctx)) {
        lines = stdinLines(ctx);
        from = "(stdin)";
      } else if (pos.length) {
        const node = ctx.fs.get(absPath(ctx, pos[0]));
        if (!node || !isFile(node)) return err(`shuf: ${pos[0]}: no such file`);
        lines = contentLines(node.content);
        from = pos[0];
      } else {
        return err("usage: shuf <file>  ·  … | shuf  ·  shuf -e a b c");
      }
      if (!lines.length) return [`no lines to shuffle in ${from}`];
      return [`${from}: ${lines.length} line(s) shuffled`, ...shuffled(lines)];
    },
  },
  {
    name: "yes", cat: "text", desc: "repeat a string n times (bounded)", usage: "yes [text] [count 1-100]",
    run: (ctx) => {
      const lastTok = ctx.args[ctx.args.length - 1] ?? "";
      if (ctx.args.length === 1 && /^\d+$/.test(lastTok)) {
        return Array.from({ length: Math.max(1, Math.min(parseInt(lastTok, 10), 100)) }, () => "y");
      }
      const text = ctx.args.length >= 2 ? ctx.args.slice(0, -1).join(" ") : "y";
      const count = /^\d+$/.test(lastTok) && ctx.args.length >= 2 ? Math.min(parseInt(lastTok, 10), 100) : 5;
      return Array.from({ length: Math.max(1, count) }, () => text);
    },
  },
  {
    name: "seq", cat: "text", desc: "print a number sequence", usage: "seq <end> | seq <start> <end> | seq <start> <end> <step>",
    run: (ctx) => {
      const nums = ctx.args.map((a) => parseFloat(a));
      if (!nums.length || nums.length > 3 || nums.some((v) => !Number.isFinite(v))) {
        return err("usage: seq <end> | seq <start> <end> | seq <start> <end> <step>");
      }
      let [start, end, step] = nums.length === 1 ? [1, nums[0], 1] : nums.length === 2 ? [nums[0], nums[1], 1] : nums;
      if (step === 0) return err("seq: step cannot be 0");
      if ((end - start) * step < 0) step = -Math.abs(step);
      const out: string[] = [];
      const max = 1000;
      for (let v = start; (step > 0 ? v <= end : v >= end) && out.length < max; v += step) {
        out.push(String(v));
      }
      if (out.length >= max) out.push(`… truncated at ${max} values`);
      return out.length ? out : ["(empty range)"];
    },
  },
  {
    name: "factor", cat: "text", desc: "prime factorization of an integer", usage: "factor <n>",
    run: (ctx) => {
      const n = parseInt(ctx.args[0] ?? "", 10);
      if (!Number.isInteger(n) || n < 1) return err("usage: factor <integer ≥ 1>");
      if (n === 1) return ["1 has no prime factorization"];
      const f = primeFactors(n);
      const grouped = new Map<number, number>();
      for (const p of f) grouped.set(p, (grouped.get(p) ?? 0) + 1);
      const parts = [...grouped.entries()].map(([p, e]) => (e > 1 ? `${p}^${e}` : `${p}`));
      return [`${n} = ${f.join(" × ")}${grouped.size > 1 ? `  (= ${parts.join(" × ")})` : ""}`, f.length === 1 ? `${n} is prime` : `${f.length} prime factor(s)`];
    },
  },
  {
    name: "strdist", cat: "text", desc: "Levenshtein edit distance + similarity", usage: "strdist <wordA> <wordB>",
    run: (ctx) => {
      if (ctx.args.length < 2) return err("usage: strdist <wordA> <wordB>");
      const [a, b] = ctx.args.slice(0, 2);
      const d = levenshtein(a.toLowerCase(), b.toLowerCase());
      const maxLen = Math.max(a.length, b.length) || 1;
      const pct = Math.round((1 - d / maxLen) * 100);
      return [
        `distance('${a}', '${b}') = ${d}`,
        `similarity: ${pct}%`,
        d === 0 ? "identical" : pct > 80 ? "likely a typo of each other" : pct > 50 ? "similar" : "quite different",
      ];
    },
  },
  {
    name: "units", cat: "text", desc: "unit conversion", usage: "units <value> <from> <to>",
    run: (ctx) => {
      if (ctx.args.length < 3) return err("usage: units <value> <from> <to>  (km mi kg lb c f l gal...)");
      const val = parseFloat(ctx.args[0]);
      if (Number.isNaN(val)) return err(`units: '${ctx.args[0]}' is not a number`);
      const res = convert(val, ctx.args[1], ctx.args[2]);
      if (res === null) return err(`units: cannot convert ${ctx.args[1]} -> ${ctx.args[2]}`);
      return [ `${val} ${ctx.args[1]} = ${Math.round(res * 1e6) / 1e6} ${ctx.args[2]}` ];
    },
  },
];
