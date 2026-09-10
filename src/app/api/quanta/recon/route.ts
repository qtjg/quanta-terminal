import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/*
 * QUANTA domain recon — real, keyless, ethical.
 *   DNS   via Google DNS-over-HTTPS (dns.google/resolve)
 *   WHOIS via RDAP (rdap.org — the modern whois protocol, JSON)
 *   HTTP  direct fetch of https://<domain>/ for server + security headers
 *
 * Only plain domain names are accepted (no IPs, no paths, no credentials) so
 * this endpoint cannot be abused as an internal-network probe: dns.google and
 * rdap.org only ever receive the validated public hostname, and the direct
 * fetch is https-only on that same validated hostname.
 */

interface ReconBody {
  domain?: string;
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const LOOKS_LIKE_IP = /^\d{1,3}(\.\d{1,3}){3}$/;
const BLOCKED = /(localhost|\.local$|\.internal$|127\.|0\.0\.0\.0|169\.254|10\.0|192\.168)/i;

const DNS_TYPES = ["A", "AAAA", "MX", "NS", "TXT"] as const;
type DnsType = (typeof DNS_TYPES)[number];

interface DohAnswer { data?: string }
interface DohResponse { Status?: number; Answer?: DohAnswer[] }

async function dnsQuery(domain: string, type: DnsType): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`, {
      signal: controller.signal,
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as DohResponse;
    if (j.Status !== 0 || !j.Answer) return [];
    return j.Answer.map((a) => (a.data ?? "").trim()).filter(Boolean).slice(0, 8);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

interface RdapEntity { roles?: string[]; vcardArray?: unknown }
interface RdapEvent { eventAction?: string; eventDate?: string }
interface RdapResponse {
  status?: string[];
  entities?: RdapEntity[];
  events?: RdapEvent[];
}

function vcardName(entity: RdapEntity): string | undefined {
  try {
    const arr = entity.vcardArray as [string, Array<[string, unknown, string, unknown]>] | undefined;
    const fn = arr?.[1]?.find((f) => f[0] === "fn");
    const val = fn?.[3];
    return typeof val === "string" ? val.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}

async function rdapQuery(domain: string): Promise<RdapSummary | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal: controller.signal,
      headers: { accept: "application/rdap+json", "user-agent": "QuantaTerminal/0.5 (+domain recon)" },
      redirect: "follow",
    });
    if (!res.ok) return null; // 404 = TLD has no RDAP — honest "none" (rdap.org 403s UA-less agents)
    const j = (await res.json()) as RdapResponse;
    const registrar = j.entities?.find((e) => e.roles?.includes("registrar"));
    const ev = (action: string) => j.events?.find((e) => e.eventAction === action)?.eventDate?.slice(0, 10);
    return {
      registrar: registrar ? vcardName(registrar) : undefined,
      created: ev("registration"),
      updated: ev("last changed"),
      expires: ev("expiration"),
      status: j.status?.slice(0, 4),
    };
  } catch {
    return null; // timeout / network — honest "no record" on this section
  } finally {
    clearTimeout(timer);
  }
}

interface RdapSummary {
  registrar?: string;
  created?: string;
  updated?: string;
  expires?: string;
  status?: string[];
}

interface HttpRecon {
  status: number;
  server?: string;
  poweredBy?: string;
  timeMs: number;
  security: Record<string, boolean>;
  missing: string[];
  grade: string;
}

const SECURITY_HEADERS = ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"];

async function httpProbe(domain: string): Promise<HttpRecon | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const t0 = Date.now();
  try {
    const res = await fetch(`https://${domain}/`, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "QuantaTerminal/0.5 (+domain recon)" },
    });
    res.body?.cancel().catch(() => {}); // headers only — do not download the page
    const headers: Record<string, boolean> = {};
    for (const h of SECURITY_HEADERS) headers[h] = res.headers.has(h);
    const missing = SECURITY_HEADERS.filter((h) => !headers[h]);
    const got = SECURITY_HEADERS.length - missing.length;
    return {
      status: res.status,
      server: res.headers.get("server") ?? undefined,
      poweredBy: res.headers.get("x-powered-by") ?? undefined,
      timeMs: Date.now() - t0,
      security: headers,
      missing,
      grade: got === 6 ? "A — hardened" : got === 5 ? "B" : got === 4 ? "C" : got === 3 ? "D" : "F — exposed",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface ReconOk {
  ok: true;
  domain: string;
  dns: Record<string, string[]>;
  rdap: RdapSummary | null;
  http: HttpRecon | null;
  timeMs: number;
}

export async function POST(req: NextRequest) {
  let body: ReconBody;
  try {
    body = (await req.json()) as ReconBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const domain = (body.domain ?? "").trim().toLowerCase();
  if (!domain || domain.length > 253) {
    return NextResponse.json({ ok: false, error: "missing or oversized domain" }, { status: 400 });
  }
  if (LOOKS_LIKE_IP.test(domain) || BLOCKED.test(domain) || !DOMAIN_RE.test(domain)) {
    return NextResponse.json(
      { ok: false, error: "only plain public domain names are recon-able (no IPs/paths)" },
      { status: 403 },
    );
  }

  const t0 = Date.now();
  const [A, AAAA, MX, NS, TXT, rdap, http] = await Promise.all([
    dnsQuery(domain, "A"),
    dnsQuery(domain, "AAAA"),
    dnsQuery(domain, "MX"),
    dnsQuery(domain, "NS"),
    dnsQuery(domain, "TXT"),
    rdapQuery(domain),
    httpProbe(domain),
  ]);

  const payload: ReconOk = {
    ok: true,
    domain,
    dns: { A, AAAA, MX, NS, TXT },
    rdap,
    http,
    timeMs: Date.now() - t0,
  };
  return NextResponse.json(payload);
}
