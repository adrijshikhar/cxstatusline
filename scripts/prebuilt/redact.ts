/**
 * Redaction for anything that reaches a public-ish surface: a step summary, an issue body, a
 * thrown error message. Build logs routinely contain credentials that GitHub itself would not
 * mask (a token echoed by a subprocess, a presigned asset URL), so every excerpt is filtered
 * before it is written anywhere, not just the ones we expect to be dirty.
 */

/** `ghp_`/`ghs_`/`gho_`/`ghu_`/`ghr_` tokens. */
const CLASSIC_TOKEN = /\bgh[porsu]_[A-Za-z0-9]{16,}/g;
/** Fine-grained personal access tokens. */
const FINE_GRAINED_TOKEN = /\bgithub_pat_[A-Za-z0-9_]{20,}/g;
/** Any line carrying an Authorization header, header value included. */
const AUTH_HEADER = /^.*\bauthorization\s*:.*$/gim;
/** A URL with a query string - presigned asset URLs put their signature there. */
const QUERY_URL = /\bhttps?:\/\/[^\s"'<>]+\?[^\s"'<>]*/g;

const TOKEN_PLACEHOLDER = "[redacted-token]";
const MAX_LINE = 200;

/** Strip credentials from `text`. Never throws; a redacted string is always safe to publish. */
export function redact(text: string): string {
  return text
    .replace(FINE_GRAINED_TOKEN, TOKEN_PLACEHOLDER)
    .replace(CLASSIC_TOKEN, TOKEN_PLACEHOLDER)
    .replace(QUERY_URL, (url) => `${url.slice(0, url.indexOf("?"))}?[redacted-query]`)
    .replace(AUTH_HEADER, "[redacted-authorization-header]");
}

/**
 * A bounded, redacted tail of an error stream. The tail, not the head: a failing `cargo build`
 * prints hundreds of progress lines before the diagnostic that matters. Long lines are clipped
 * too, because a single line can carry an entire base64 blob.
 */
export function errorExcerpt(text: string, maxLines = 20): string {
  const lines = redact(text).replaceAll("\r\n", "\n").trimEnd().split("\n");
  return lines
    .slice(-maxLines)
    .map((line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)} […]` : line))
    .join("\n");
}
