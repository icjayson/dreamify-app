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
 */
export function setAtPath<T extends AnyRecord>(target: T, path: (string | number)[], value: unknown): T {
  if (path.length === 0) return target;
  const [head, ...rest] = path;
  const cur = (target as AnyRecord)[head as string];
  const next = rest.length === 0
    ? value
    : setAtPath(isPlainObject(cur) ? cur : (typeof head === 'number' ? ([] as unknown as AnyRecord) : ({} as AnyRecord)), rest, value);
  if (Array.isArray(target)) {
    const copy = [...(target as unknown as unknown[])];
    copy[head as number] = next;
    return copy as unknown as T;
  }
  return { ...target, [head]: next } as T;
}
