/* QUANTA system + network commands: ps kill free lscpu top netstat ping curl neofetch */

import { CmdCtx, CmdDef, err, fmtUptime, swElapsed, padCell } from "./core";
import { fmtBytes, wrapText } from "./text-tools";

export interface FetchResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  bodyHead?: string;
  bytes?: number;
  timeMs?: number;
  error?: string;
}

export async function fetchViaApi(apiBase: string, url: string, maxChars: number): Promise<FetchResult> {
  try {
    const res = await fetch(`${apiBase}/api/quanta/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, maxChars }),
    });
    return (await res.json()) as FetchResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export const SYS_COMMANDS: CmdDef[] = [
  {
    name: "ps", cat: "sys", desc: "process snapshot (quanta services)",
    run: (ctx) => {
      const out = [
        `${padCell("PID", 7)}${padCell("NAME", 16)}${padCell("CPU%", 7)}${padCell("MEM(K)", 8)}STATE`,
      ];
      for (const p of ctx.processes) {
        out.push(`${padCell(String(p.pid), 7)}${padCell(p.name, 16)}${padCell(String(p.cpu), 7)}${padCell(String(p.mem), 8)}${p.state}`);
      }
      out.push("(in-browser sandbox — these are quanta's own services)");
      return out;
    },
  },
  {
    name: "kill", cat: "sys", desc: "signal a process by pid", usage: "kill <pid>",
    run: (ctx) => {
      const pid = parseInt(ctx.args[0] ?? "", 10);
      if (!pid) return err("usage: kill <pid>");
      const i = ctx.processes.findIndex((p) => p.pid === pid);
      if (i < 0) return err(`kill: (${pid}) - no such process`);
      const [p] = ctx.processes.splice(i, 1);
      return [`sent SIGTERM to ${p.name} (${p.pid})`, "process reaped — vfs-daemon will respawn it on next boot"];
    },
  },
  {
    name: "free", cat: "sys", desc: "memory overview",
    run: (ctx) => {
      const perfMem = (globalThis as { performance?: { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } } })
        .performance?.memory;
      const used = perfMem ? perfMem.usedJSHeapSize : 148 * 1024 * 1024;
      const limit = perfMem ? perfMem.jsHeapSizeLimit : 4 * 1024 * 1024 * 1024;
      const vfs = ctx.fs.countAll().bytes;
      return [
        "               total        used        free",
        `Mem:      ${padCell(fmtBytes(limit), 12)}${padCell(fmtBytes(used), 12)}${padCell(fmtBytes(limit - used), 12)}`,
        `Quanta FS: ${fmtBytes(vfs)} across ${ctx.fs.countAll().files} files`,
        perfMem ? "(live JS heap via performance.memory)" : "(performance.memory unavailable — estimates shown)",
      ];
    },
  },
  {
    name: "lscpu", cat: "sys", desc: "cpu info of this device",
    run: (ctx) => {
      const cores = ctx.bootInfo.cores || 4;
      return [
        `Architecture:        ${ctx.bootInfo.platform}`,
        `CPU(s):              ${cores} logical core(s) available to this browser`,
        `Thread(s) per core:  unknown (sandboxed)`,
        `Model name:          ${ctx.bootInfo.ua.slice(0, 72)}`,
        `L1d cache:           n/a`,
      ];
    },
  },
  {
    name: "top", cat: "sys", desc: "one-shot system dashboard",
    run: (ctx) => {
      const now = ctx.now().getTime();
      const cpuTotal = Math.round(ctx.processes.reduce((s, p) => s + p.cpu, 0) * 10) / 10;
      return [
        `top - ${ctx.now().toLocaleTimeString()}  up ${fmtUptime(ctx.sessionStart, now)}   load avg: ${(cpuTotal / 25).toFixed(2)}`,
        `Tasks: ${ctx.processes.length} total, 1 running`,
        `%Cpu(s): ${cpuTotal.toFixed(1)} us,  0.4 sy,  ${Math.max(0, 99 - cpuTotal).toFixed(1)} id`,
        "",
        ...ctx.processes.slice(0, 5).map((p) =>
          `${padCell(String(p.pid), 7)}${padCell("mayank", 9)}${padCell(String(p.cpu), 7)}${padCell(String(p.mem), 8)}${p.name}`),
        "",
        `stopwatch: ${ctx.sw.running ? `RUNNING ${fmtElapsedShort(swElapsed(ctx.sw, now))}` : "idle"}  |  theme: ${ctx.theme}`,
      ];
    },
  },
  {
    name: "netstat", cat: "sys", desc: "sandbox connection table",
    run: (ctx) => [
      "Proto Local                 Peer                  State",
      "tcp   quanta:443             *.space-z.ai:443      ESTABLISHED",
      "tcp   quanta:3000            127.0.0.1:53312       LISTEN",
      "tcp   quanta:8443            ai-gateway.internal   ESTABLISHED",
      "udp   quanta:53              1.1.1.1:53            -",
      "(sandbox view — browser cannot enumerate real sockets)",
    ],
  },
  {
    name: "ping", cat: "net", desc: "latency probe (simulated RTT)", usage: "ping <host> [count]",
    run: async (ctx) => {
      const host = ctx.args[0];
      if (!host) return err("usage: ping <host> [count]");
      const count = Math.min(parseInt(ctx.args[1] ?? "4", 10) || 4, 8);
      const out = [`PING ${host} 56 bytes of data:`];
      let total = 0;
      for (let i = 1; i <= count; i++) {
        // real await + jittered RTT — honest about simulation
        await new Promise((r) => setTimeout(r, 180 + Math.random() * 160));
        const rtt = 8 + Math.random() * 30;
        total += rtt;
        out.push(`64 bytes from ${host}: icmp_seq=${i} ttl=118 time=${rtt.toFixed(1)} ms`);
      }
      out.push("", `--- ${host} ping statistics ---`, `${count} transmitted, ${count} received, 0% loss, avg ${(total / count).toFixed(1)} ms (simulated RTT)`);
      return out;
    },
  },
  {
    name: "curl", cat: "net", desc: "REAL http request via quanta backend", usage: "curl <url>",
    run: async (ctx) => {
      const url = ctx.args[0];
      if (!url) return err("usage: curl <url>");
      if (!/^https?:\/\//i.test(url)) return err("curl: url must start with http:// or https://");
      const res = await fetchViaApi(ctx.apiBase, url, 900);
      if (!res.ok) return err(`curl: ${res.error ?? "request failed"}`);
      const out = [
        `HTTP/1.1 ${res.status} ${res.statusText}`,
        ...(res.headers ? Object.entries(res.headers).slice(0, 6).map(([k, v]) => `${k}: ${v.slice(0, 70)}`) : []),
        `transfer-time: ${res.timeMs} ms, received ${res.bytes} bytes`,
        "",
        ...(res.bodyHead ? res.bodyHead.split("\n") : ["(empty body)"]),
      ];
      return out;
    },
  },
  {
    name: "headers", cat: "net", desc: "REAL HTTP response headers for a URL", usage: "headers <url>",
    run: async (ctx) => {
      const url = ctx.args[0];
      if (!url) return err("usage: headers <url>");
      if (!/^https?:\/\//i.test(url)) return err("headers: url must start with http:// or https://");
      const res = await fetchViaApi(ctx.apiBase, url, 100);
      if (!res.ok) return err(`headers: ${res.error ?? "request failed"}`);
      const hs = Object.entries(res.headers ?? {});
      if (!hs.length) return err("headers: no headers returned");
      const out = [`HTTP ${res.status} ${res.statusText}`, `url: ${url}`, `${hs.length} header(s):`, ""];
      for (const [k, v] of hs) out.push(`  ${padCell(k, 22)} ${v.length > 90 ? v.slice(0, 90) + "…" : v}`);
      out.push("", `served in ${res.timeMs} ms`);
      return out;
    },
  },
  {
    name: "isup", cat: "net", desc: "REAL site availability check (status + latency)", usage: "isup <url>",
    run: async (ctx) => {
      const url = ctx.args[0];
      if (!url) return err("usage: isup <url>");
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const t0 = Date.now();
      const res = await fetchViaApi(ctx.apiBase, target, 100);
      const roundTrip = Date.now() - t0;
      if (!res.ok) {
        return [
          `✗ ${target} — DOWN or unreachable`,
          `error: ${res.error ?? "unknown"} (${roundTrip} ms)`,
        ];
      }
      const status = res.status ?? 0;
      const verdict = status < 400 ? "UP" : "REACHED (error status)";
      const mark = status < 400 ? "✓" : "!";
      return [
        `${mark} ${target} — ${verdict}`,
        `status: ${status} ${res.statusText ?? ""}`.trimEnd(),
        `response: ${res.timeMs} ms (round trip ${roundTrip} ms), ${res.bytes ?? 0} bytes`,
      ];
    },
  },
  {
    name: "tz", cat: "sys", desc: "current time across timezones (real Intl)", usage: "tz [list]  ·  tz <Region/City> ...",
    run: (ctx) => {
      const now = ctx.now();
      if (ctx.args[0] === "list") {
        const zones = ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
        return [`zones supported by name (via Intl):`, ...zones.map((z) => `  ${z}`)];
      }
      const zones = ctx.args.length
        ? ctx.args
        : [...new Set([ctx.bootInfo.tz || "UTC", "UTC"])];
      const out: string[] = [];
      for (const zone of zones) {
        try {
          const fmt = new Intl.DateTimeFormat("en-GB", {
            timeZone: zone, dateStyle: "medium", timeStyle: "short", hour12: false,
          });
          out.push(`${padCell(zone, 24)} ${fmt.format(now)}`);
        } catch {
          out.push(`${padCell(zone, 24)} unknown timezone — try 'tz list'`);
        }
      }
      return out;
    },
  },
  {
    name: "cal", cat: "sys", desc: "calendar for a month (current or given)", usage: "cal [month 1-12] [year]",
    run: (ctx) => {
      const now = ctx.now();
      let year = now.getFullYear();
      let month = now.getMonth() + 1; // 1-12
      if (ctx.args.length >= 2) {
        const m = parseInt(ctx.args[0], 10), y = parseInt(ctx.args[1], 10);
        if (!m || m < 1 || m > 12 || !y || y < 1 || y > 9999) return err("usage: cal [month 1-12] [year]");
        [month, year] = [m, y];
      } else if (ctx.args.length === 1) {
        const m = parseInt(ctx.args[0], 10);
        if (!m || m < 1 || m > 12) return err("usage: cal [month 1-12] [year]");
        month = m;
      }
      const title = new Date(year, month - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
      const days = new Date(year, month, 0).getDate();
      // weekday of the 1st (0=Sun..6=Sat)
      const firstDow = new Date(year, month - 1, 1).getDay();
      const lines = [
        title.padStart(Math.floor((20 + title.length) / 2)).padEnd(20),
        "Su Mo Tu We Th Fr Sa",
      ];
      let row = "   ".repeat(firstDow);
      for (let d = 1; d <= days; d++) {
        row += String(d).padStart(2) + " ";
        if ((firstDow + d) % 7 === 0) { lines.push(row.trimEnd()); row = ""; }
      }
      if (row) lines.push(row.trimEnd());
      if (month === now.getMonth() + 1 && year === now.getFullYear()) {
        lines.push("", `today: ${now.toLocaleDateString("en-GB")}`);
      }
      return lines;
    },
  },
  {
    name: "neofetch", cat: "sys", desc: "system summary card",
    run: (ctx) => {
      const { files, bytes } = ctx.fs.countAll();
      const now = ctx.now().getTime();
      const logo = [
        "  ▄▄▄▄▄▄▄  ",
        " █████████ ",
        "██ ▀▀▀▀▀██ ",
        "██ ████ ██ ",
        "██ ▄▄▄▄ ██ ",
        " █████████ ",
        "  ▀▀▀▀▀▀▀  ",
      ];
      const info = [
        `${ctx.user}@${ctx.host}`,
        "─────────────────────",
        `OS:      Quanta OS 0.5.0 (web)`,
        `Kernel:  quanta-vfs 1.0`,
        `Shell:   quanta-sh 0.5`,
        `Theme:   ${ctx.theme}`,
        `Uptime:  ${fmtUptime(ctx.sessionStart, now)}`,
        `Files:   ${files} in VFS (${fmtBytes(bytes)})`,
        `CPU:     ${ctx.bootInfo.cores || "?"} cores`,
        `Display: ${ctx.bootInfo.screen}`,
        `Locale:  ${ctx.bootInfo.lang}  TZ: ${ctx.bootInfo.tz}`,
      ];
      const rows = Math.max(logo.length, info.length);
      const out: string[] = [];
      for (let i = 0; i < rows; i++) {
        out.push(`${padCell(logo[i] ?? "", 12)}${info[i] ?? ""}`);
      }
      return out;
    },
  },
];

function fmtElapsedShort(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function wrapStopwatchNote(s: string): string[] { return wrapText(s, 64); }
