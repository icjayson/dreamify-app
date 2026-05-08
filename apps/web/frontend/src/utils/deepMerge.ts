/**
 * Plain-object deep merge. Arrays are replaced (not merged) — semantically
 * correct for chart datasets/data, where partial array merges would corrupt order.
 * Skips undefined values in the source.
 */
type AnyRecord = Record<string, unknown>;

const isPlainObject = (v: unknown): v is AnyRecord =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

export function deepMerge<T extends AnyRecord>(target: T, source: Partial<T> | AnyRecord | undefined | null): T {
  if (!source) return { ...target };
  const out: AnyRecord = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = (source as AnyRecord)[key];
    if (srcVal === undefined) continue;
    const tgtVal = out[key];
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      out[key] = deepMerge(tgtVal, srcVal);
    } else {
      out[key] = srcVal;
    }
  }
  return out as T;
}

/**
 * Set a value at a dot-path inside an object, returning a new object.
 * Used by side-panel forms binding nested fields like 'styling.legendPosition'.
 *
 * Container-type heuristic: when seeding a missing intermediate level, the
 * shape (`[]` vs `{}`) is decided by the NEXT head's type — numeric → array,
 * string → object. This prevents producing `{ data: { '2': {...} } }` when the
 * intent is `{ data: [..., {...}, ...] }`. Note: even with this fix, applying
 * a sparse-array patch via deepMerge will still wipe non-touched indices —
 * use full-array patches for table data edits.
 */
export function setAtPath<T extends AnyRecord>(target: T, path: (string | number)[], value: unknown): T {
  if (path.length === 0) return target;
  const [head, ...rest] = path;
  const cur = (target as AnyRecord)[head as string];

  let next: unknown;
  if (rest.length === 0) {
    next = value;
  } else {
    const nextHead = rest[0];
    const seed: AnyRecord = isPlainObject(cur) || Array.isArray(cur)
      ? (cur as AnyRecord)
      : (typeof nextHead === 'number' ? ([] as unknown as AnyRecord) : ({} as AnyRecord));
    next = setAtPath(seed, rest, value);
  }

  if (Array.isArray(target)) {
    const copy = [...(target as unknown as unknown[])];
    if (typeof head === 'number') {
      copy[head] = next;
    } else {
      // Path mismatch (string head into array target). Bail to defensive
      // object so we don't pollute the array with non-index properties.
      return { [head]: next } as unknown as T;
    }
    return copy as unknown as T;
  }
  return { ...target, [head]: next } as T;
}
