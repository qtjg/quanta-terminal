/* QUANTA dev tools — pw base ts (all real, browser-native crypto & Intl) */

import { CmdCtx, CmdDef, err } from "./core";

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
];
