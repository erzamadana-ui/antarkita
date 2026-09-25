// Log terstruktur (JSON satu baris) dengan redaksi otomatis.
// ATURAN: jangan pernah mencatat kunci/secret/token/signature/PAN. Semua yang lewat log.* disaring di sini:
//   • kunci bernama sensitif (…key, …secret, …token, signature, authorization, password, pin, cvv, pan, card number) → "[REDACTED]"
//   • PII (email, telepon, nomor rekening) → disamarkan (sisa 4 karakter terakhir / inisial email)
//   • nilai string yang MIRIP rahasia di mana pun (JWT, "Bearer …", "Basic …", kunci Midtrans, sb_secret_…, PAN lolos Luhn)
//   • nilai rahasia yang didaftarkan saat runtime lewat registerSecret() (mis. Merchant Key yang dibaca dari DB)

const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|password|passwd|pass|secret|pin|cvv|cvc|cvv2|pan|signature|signature_key|x-cron-secret|apikey)$|secret|token|(?:^|_|-)key$|[a-z]Key$|card_?number|cardno|card_?num/i;
const PII_KEY = /^(email|e_mail|phone|mobile_?phone|mobilephone|msisdn|bank_?account|account_?number|accountnumber|account_?no|beneficiary_?account|bank_?account_?number|va_?number|virtual_?account)$/i;

const secrets = new Set<string>();
/** Daftarkan nilai rahasia yang dimuat saat runtime supaya tersensor bila muncul di pesan apa pun. */
export function registerSecret(v: string | null | undefined): void {
  if (v && v.length >= 6) secrets.add(v);
}

function luhnOk(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function maskTail(s: string, keep = 4): string {
  const t = String(s);
  return t.length <= keep ? "*".repeat(t.length) : "*".repeat(Math.min(8, t.length - keep)) + t.slice(-keep);
}

function maskEmail(s: string): string {
  const m = String(s).match(/^(.)[^@]*@(.+)$/);
  return m ? `${m[1]}***@${m[2]}` : maskTail(s);
}

/** Sensor pola rahasia di dalam sebuah string bebas. */
export function redactString(input: string): string {
  let s = input;
  for (const sec of secrets) if (s.includes(sec)) s = s.split(sec).join("[REDACTED]");
  s = s.replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[REDACTED_JWT]");
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [REDACTED]");
  s = s.replace(/\b(SB-)?Mid-(server|client)-[A-Za-z0-9_-]+/g, "[REDACTED_MIDTRANS_KEY]");
  s = s.replace(/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTED_SB_KEY]");
  // Calon PAN: 13–19 digit, boleh dipisah spasi/tanda hubung, lolos Luhn → hanya 4 digit terakhir.
  s = s.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const d = m.replace(/[ -]/g, "");
    return d.length >= 13 && d.length <= 19 && luhnOk(d) ? `[PAN ****${d.slice(-4)}]` : m;
  });
  if (s.length > 2000) s = s.slice(0, 2000) + "…[truncated]";
  return s;
}

/** Salinan dalam (deep copy) dengan redaksi. Aman untuk siklus & kedalaman besar. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (typeof value !== "object") return String(value);
  if (depth > 8) return "[depth]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) out[k] = v == null || v === "" ? v : "[REDACTED]";
    else if (PII_KEY.test(k) && (typeof v === "string" || typeof v === "number")) out[k] = /mail/i.test(k) ? maskEmail(String(v)) : maskTail(String(v));
    else out[k] = redact(v, depth + 1, seen);
  }
  return out;
}

type Level = "debug" | "info" | "warn" | "error";
function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...(redact(fields ?? {}) as Record<string, unknown>) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
