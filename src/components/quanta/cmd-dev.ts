/* QUANTA dev tools — pw base ts (all real, browser-native crypto & Intl) */

import { CmdCtx, CmdDef, err, hasStdin } from "./core";

export const DEV_COMMANDS: CmdDef[] = [
  {
    name: "pw", cat: "dev", desc: "password generator (crypto-grade randomness)", usage: "pw [length] [--no-symbols] [--count n]",
    run: (ctx) => {
      let symbols = true, count = 1, pendingCount = false;
      let lenArg: string | null = null;
      for (const a of ctx.args) {
        if (a === "--no-symbols") symbols = false;
        else if (a === "--count") pendingCount = true;
        else if (pendingCount) { count = Math.max(1, Math.min(parseInt(a, 10) || 1, 10)); pendingCount = false; }
        else if (lenArg === null) lenArg = a;
      }
      const len = Math.max(8, Math.min(parseInt(lenArg ?? "20", 10) || 20, 64));
      const lower = "abcdefghijkmnopqrstuvwxyz", upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
      const digits = "23456789", syms = "!@#$%^&*()-_=+[]{};:,.?";
      const alphabet = lower + upper + digits + (symbols ? syms : "");
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        const bytes = crypto.getRandomValues(new Uint32Array(len));
        let pwStr = "";
        for (let j = 0; j < len; j++) pwStr += alphabet[bytes[j] % alphabet.length];
        out.push(pwStr);
      }
      out.push(`${len} chars · ${alphabet.length}-char alphabet${symbols ? " +symbols" : ""} · ambiguous chars excluded · crypto.getRandomValues`);
      return out;
    },
  },
  {
    name: "base", cat: "dev", desc: "convert number bases (bin/oct/dec/hex)", usage: "base <from:to> <value>  ·  base 10:16 255  ·  base 16:10 0xff",
    run: (ctx) => {
      const spec = ctx.args[0] ?? "";
      const m = spec.match(/^(\d{1,2}):(\d{1,2})$/);
      if (!m) return err("usage: base <from:to> <value>   e.g. base 10:16 255");
      const from = parseInt(m[1], 10), to = parseInt(m[2], 10);
      if (![2, 8, 10, 16].includes(from) || ![2, 8, 10, 16].includes(to)) {
        return err("base: supported bases are 2, 8, 10, 16");
      }
      const value = ctx.args[1];
      if (!value) return err("usage: base <from:to> <value>");
      const clean = value.toLowerCase().replace(/^0[box]/, "");
      const n = parseInt(clean, from);
      if (Number.isNaN(n)) return err(`base: '${value}' is not a valid base-${from} number`);
      const names: Record<number, string> = { 2: "bin", 8: "oct", 10: "dec", 16: "hex" };
      const prefix = to === 16 ? "0x" : to === 2 ? "0b" : to === 8 ? "0o" : "";
      return [`${names[from]} ${value} → ${names[to]} ${prefix}${n.toString(to)}`];
    },
  },
  {
    name: "ts", cat: "dev", desc: "epoch ↔ date converter (both directions)", usage: "ts [epoch | ISO-date]",
    run: (ctx) => {
      const arg = ctx.args[0];
      if (!arg) {
        const now = ctx.now();
        return [
          `epoch ms   ${now.getTime()}`,
          `epoch s    ${Math.floor(now.getTime() / 1000)}`,
          `iso        ${now.toISOString()}`,
        ];
      }
      if (/^\d{10}$/.test(arg)) {
        const d = new Date(parseInt(arg, 10) * 1000);
        return [`epoch s    ${arg}`, `iso        ${d.toISOString()}`, `utc        ${d.toUTCString()}`];
      }
      if (/^\d{13}$/.test(arg)) {
        const d = new Date(parseInt(arg, 10));
        return [`epoch ms   ${arg}`, `iso        ${d.toISOString()}`, `utc        ${d.toUTCString()}`];
      }
      const d = new Date(arg);
      if (Number.isNaN(d.getTime())) return err(`ts: cannot parse '${arg}' — try an epoch (s/ms) or ISO date`);
      return [`iso        ${d.toISOString()}`, `epoch ms   ${d.getTime()}`, `epoch s    ${Math.floor(d.getTime() / 1000)}`];
    },
  },
  {
    name: "color", cat: "dev", desc: "hex ↔ rgb ↔ hsl + WCAG contrast", usage: "color <#hex | rgb r g b | hsl h s l>",
    run: (ctx) => {
      let r = -1, g = -1, b = -1;
      const sub = (ctx.args[0] ?? "").toLowerCase();
      if (sub === "rgb" && ctx.args.length >= 4) {
        [r, g, b] = ctx.args.slice(1, 4).map((v) => parseInt(v, 10));
      } else if (sub === "hsl" && ctx.args.length >= 4) {
        const h = parseFloat(ctx.args[1]) / 360, s = parseFloat(ctx.args[2]) / 100, l = parseFloat(ctx.args[3]) / 100;
        if ([h, s, l].some((v) => Number.isNaN(v))) return err("color: usage: color hsl <h 0-360> <s 0-100> <l 0-100>");
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        const hue = (t: number): number => {
          if (t < 0) t += 1; if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        r = Math.round(hue(h + 1 / 3) * 255); g = Math.round(hue(h) * 255); b = Math.round(hue(h - 1 / 3) * 255);
      } else {
        const hex = (ctx.args[0] ?? "").replace(/^#/, "");
        const m = hex.match(/^(?:([0-9a-f])([0-9a-f])([0-9a-f])|([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2}))$/i);
        if (!m) return err("color: usage: color <#hex | rgb r g b | hsl h s l>");
        if (m[1]) {
          r = parseInt(m[1] + m[1], 16); g = parseInt(m[2] + m[2], 16); b = parseInt(m[3] + m[3], 16);
        } else {
          r = parseInt(m[4], 16); g = parseInt(m[5], 16); b = parseInt(m[6], 16);
        }
      }
      if ([r, g, b].some((v) => Number.isNaN(v) || v < 0 || v > 255)) {
        return err("color: channels must be within range (rgb 0-255, h 0-360, s/l 0-100)");
      }
      const hexOut = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), l = (max + min) / 2;
      const d2 = max - min;
      const s = d2 === 0 ? 0 : d2 / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (d2 !== 0) {
        if (max === rn) h = ((gn - bn) / d2) % 6;
        else if (max === gn) h = (bn - rn) / d2 + 2;
        else h = (rn - gn) / d2 + 4;
        h *= 60; if (h < 0) h += 360;
      }
      const lum = (c: number): number => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      const L = 0.2126 * lum(rn) + 0.7152 * lum(gn) + 0.0722 * lum(bn);
      const ratioWhite = (1.05) / (L + 0.05), ratioBlack = (L + 0.05) / 0.05;
      const fmt = (v: number): string => `${v.toFixed(1)}:1`;
      const grade = (v: number): string => v >= 7 ? "AAA" : v >= 4.5 ? "AA" : v >= 3 ? "AA-large" : "fail";
      return [
        hexOut,
        `rgb(${r}, ${g}, ${b})`,
        `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
        `contrast  on white ${fmt(ratioWhite)} (${grade(ratioWhite)}) · on black ${fmt(ratioBlack)} (${grade(ratioBlack)})`,
        `suggested text  ${ratioWhite >= ratioBlack ? "#ffffff" : "#000000"}`,
      ];
    },
  },
  {
    name: "csv", cat: "dev", desc: "parse CSV → aligned table or JSON (quoted fields handled)", usage: "csv [json] <file>  ·  … | csv  ·  … | csv json",
    run: (ctx) => {
      const wantJson = ctx.args[0] === "json";
      const pathArg = ctx.args.find((a, i) => i !== 0 || a !== "json");
      let text: string;
      if (hasStdin(ctx)) text = ctx.stdin ?? "";
      else {
        if (!pathArg) return err("usage: csv [json] <file>   or pipe CSV text in");
        const node = ctx.fs.get(ctx.fs.resolve(ctx.cwd, pathArg));
        if (!node || node.type !== "file") return err(`csv: ${pathArg}: no such file`);
        text = node.content ?? "";
      }
      let rows: string[][] = [];
      let field = "", row: string[] = [], inQ = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
          if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
          else if (c === '"') inQ = false;
          else field += c;
        } else if (c === '"') inQ = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
        else field += c;
      }
      if (field !== "" || row.length) { row.push(field); rows.push(row); }
      rows = rows.filter((r0) => r0.some((cell) => cell.trim() !== ""));
      if (!rows.length) return err("csv: no data rows found");
      if (wantJson) {
        const [head, ...body] = rows;
        const objs = body.map((r0) => Object.fromEntries(head.map((k, i) => [k.trim(), (r0[i] ?? "").trim()])));
        return objs.map((o) => JSON.stringify(o));
      }
      const width = Math.max(...rows.map((r0) => r0.length));
      const cols: number[] = Array.from({ length: width }, (_, i) => Math.max(...rows.map((r0) => (r0[i] ?? "").length)));
      const pad = (v: string, i: number): string => v + " ".repeat(Math.max(0, cols[i] - v.length));
      const out: string[] = [];
      rows.forEach((r0, ri) => {
        out.push(r0.map((cell, i) => pad(cell, i)).join(ri === 0 ? "  " : "  ").trimEnd());
        if (ri === 0) out.push(cols.map((w) => "─".repeat(w)).join("  "));
      });
      out.push(`${rows.length - 1} data row(s), ${width} column(s)`);
      return out;
    },
  },
  {
    name: "cron", cat: "dev", desc: "explain a cron expression + next real run times", usage: "cron <expr>   e.g. cron */15 9-17 * * 1-5",
    run: (ctx) => {
      const FIELDS = ["minute", "hour", "day-of-month", "month", "day-of-week"];
      const RANGES = [60, 24, 31, 12, 7];
      const expr = ctx.args.join(" ").trim();
      if (!expr) return err("usage: cron <minute hour dom month dow>");
      const parts = expr.split(/\s+/);
      if (parts.length !== 5) return err("cron: needs exactly 5 fields — minute hour day-of-month month day-of-week");
      const NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const expand = (field: string, idx: number): number[] | null => {
        const names = idx === 4 ? DAYS : idx === 3 ? NAMES : null;
        const resolve = (tok: string): number | null => {
          const low = tok.toLowerCase();
          if (names) {
            const i = names.findIndex((n) => low.startsWith(n));
            if (i >= 0) return idx === 4 ? i : i + 1;
          }
          const n = parseInt(low, 10);
          return Number.isNaN(n) ? null : n;
        };
        const out = new Set<number>();
        for (const piece of field.split(",")) {
          const [range, stepStr] = piece.split("/");
          const step = stepStr ? parseInt(stepStr, 10) : 1;
          if (!step || step < 1) return null;
          let lo = 0, hi = RANGES[idx] - 1;
          if (range !== "*") {
            const [a, b] = range.split("-");
            const av = resolve(a), bv = b != null ? resolve(b) : av;
            if (av == null || bv == null) return null;
            lo = av; hi = bv;
          }
          if (lo > hi || hi > RANGES[idx] - 1) return null;
          for (let v = lo; v <= hi; v += step) out.add(v);
        }
        return [...out].sort((a, b) => a - b);
      };
      const sets: number[][] = [];
      for (let i = 0; i < 5; i++) {
        const s = expand(parts[i], i);
        if (!s || !s.length) return err(`cron: invalid ${FIELDS[i]} field '${parts[i]}'`);
        sets.push(s);
      }
      const describe = (vals: number[], idx: number): string => {
        const all = vals.length === RANGES[idx];
        if (all) return "*";
        if (idx === 3 && vals.every((v, i2) => i2 === 0 || v === vals[i2 - 1] + 1)) return vals.map((v) => NAMES[v - 1]).join(" ");
        if (idx === 4 && vals.every((v, i2) => i2 === 0 || v === vals[i2 - 1] + 1)) return vals.map((v) => DAYS[v]).join(" ");
        if (vals.length > 8) return `${vals[0]}-${vals[vals.length - 1]} (${vals.length} values)`;
        return vals.join(" ");
      };
      const lines = FIELDS.map((f, i) => `${f.padEnd(13)} ${parts[i].padEnd(10)} → ${describe(sets[i], i)}`);
      /* next real runs — walk forward minute-by-minute, max 366 days */
      const next = new Date(ctx.now());
      next.setSeconds(0, 0);
      next.setMinutes(next.getMinutes() + 1);
      const runs: string[] = [];
      for (let i = 0; i < 525600 && runs.length < 3; i++) {
        if (sets[0].includes(next.getMinutes()) && sets[1].includes(next.getHours())
          && sets[3].includes(next.getMonth() + 1)
          && (sets[4].includes(next.getDay()) || sets[2].includes(next.getDate()))) {
          runs.push(next.toISOString().replace("T", " ").slice(0, 16) + " UTC");
        }
        next.setMinutes(next.getMinutes() + 1);
      }
      return ["FIELD         EXPR       → MATCHES", ...lines, "", "next runs:", ...runs.map((r) => `  ${r}`)];
    },
  },
];
