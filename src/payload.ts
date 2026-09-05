/**
 * Payload contract v1 — the only thing the renderer knows about Codex.
 * Frozen. New keys are additive; `payload_version` bumps only on a breaking change.
 * Every field except `payload_version` is optional: Codex omits what it does not have.
 */
export interface RateWindow {
  readonly used?: number; // 0..1
  readonly resets_at?: string; // ISO-8601 UTC
}

export interface PayloadV1 {
  readonly payload_version: 1;
  readonly model?: { readonly name?: string; readonly reasoning?: string };
  readonly git?: {
    readonly branch?: string;
    readonly changes?: { readonly additions: number; readonly deletions: number };
    readonly pr?: number;
  };
  readonly usage?: {
    readonly context_used?: number; // 0..1
    readonly context_remaining?: number; // 0..1
    readonly context_tokens?: number;
    readonly context_window?: number;
    readonly used_tokens?: number;
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cached_input_tokens?: number;
    readonly five_hour?: RateWindow;
    readonly weekly?: RateWindow;
  };
  readonly session?: {
    readonly id?: string;
    readonly cwd?: string;
    readonly project_root?: string;
    readonly hostname?: string;
    readonly approval_mode?: string; // Codex's own identifier, e.g. "on-request"
    readonly permissions?: string; // Codex's own identifier, e.g. "workspace-write"
    readonly run_state?: string; // starting | ready | working | thinking | waiting
    readonly codex_version?: string;
    readonly started_at?: string;
    readonly thread_title?: string;
  };
}

export class PayloadError extends Error {
  override readonly name = "PayloadError";
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const obj = (v: unknown): Obj => (isObj(v) ? v : {});

/**
 * The shape `compact` returns: same keys, all optional, `undefined` removed from every value.
 * Why the mapped type: under `exactOptionalPropertyTypes` a plain `<T>(o: T) => T` keeps
 * `| undefined` in each property type, and `T | undefined` is not assignable to `x?: T`.
 */
type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** Drop `undefined` values so `toEqual` comparisons and JSON output stay clean. */
function compact<T extends object>(o: T): Defined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Defined<T>;
}

/** The type of `PayloadV1["git"]["changes"]`, including its `undefined`. */
type Changes = NonNullable<PayloadV1["git"]>["changes"];

function window(v: unknown): RateWindow | undefined {
  if (!isObj(v)) return undefined;
  return compact({ used: num(v.used), resets_at: str(v.resets_at) });
}

function changes(v: unknown): Changes {
  if (!isObj(v)) return undefined;
  const additions = num(v.additions);
  const deletions = num(v.deletions);
  return additions === undefined || deletions === undefined ? undefined : { additions, deletions };
}

export function parsePayload(text: string): PayloadV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PayloadError("payload is not valid JSON");
  }
  if (!isObj(raw)) throw new PayloadError("payload must be a JSON object");
  if (raw.payload_version === undefined) throw new PayloadError("payload_version is required");
  if (raw.payload_version !== 1) {
    throw new PayloadError(`payload_version ${String(raw.payload_version)} is not supported; only 1 is`);
  }
  const model = obj(raw.model);
  const git = obj(raw.git);
  const usage = obj(raw.usage);
  const session = obj(raw.session);
  // One boundary cast: `Defined<T>` makes every key optional, including `payload_version`.
  return compact({
    payload_version: 1 as const,
    model: isObj(raw.model) ? compact({ name: str(model.name), reasoning: str(model.reasoning) }) : undefined,
    git: isObj(raw.git)
      ? compact({ branch: str(git.branch), changes: changes(git.changes), pr: num(git.pr) })
      : undefined,
    usage: isObj(raw.usage)
      ? compact({
          context_used: num(usage.context_used),
          context_remaining: num(usage.context_remaining),
          context_tokens: num(usage.context_tokens),
          context_window: num(usage.context_window),
          used_tokens: num(usage.used_tokens),
          input_tokens: num(usage.input_tokens),
          output_tokens: num(usage.output_tokens),
          cached_input_tokens: num(usage.cached_input_tokens),
          five_hour: window(usage.five_hour),
          weekly: window(usage.weekly),
        })
      : undefined,
    session: isObj(raw.session)
      ? compact({
          id: str(session.id),
          cwd: str(session.cwd),
          project_root: str(session.project_root),
          hostname: str(session.hostname),
          approval_mode: str(session.approval_mode),
          permissions: str(session.permissions),
          run_state: str(session.run_state),
          codex_version: str(session.codex_version),
          started_at: str(session.started_at),
          thread_title: str(session.thread_title),
        })
      : undefined,
  }) as PayloadV1;
}
