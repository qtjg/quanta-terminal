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
