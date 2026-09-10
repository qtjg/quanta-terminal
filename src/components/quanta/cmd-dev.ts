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
];
