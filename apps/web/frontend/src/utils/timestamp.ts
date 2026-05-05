export type DisplayFormat = 'full' | 'date' | 'time' | 'relative';

function getDefaultLocale(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en-US';
}

function assertValidDate(date: Date, input: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${input}`);
  }
}

export function getNow(): string {
  return new Date().toISOString();
}

export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value));
}

export function normalizeToUTCISOString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  assertValidDate(date, String(value));
  return date.toISOString();
}

export function formatToDisplay(
  isoString: string,
  options?: {
    format?: DisplayFormat;
    locale?: string;
  },
): string {
  const date = new Date(isoString);
  assertValidDate(date, isoString);

  const tz = getUserTimezone();
  const locale = options?.locale ?? getDefaultLocale();

  switch (options?.format) {
    case 'date':
      return new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date);
    case 'time':
      return new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
    case 'relative':
      return formatRelative(date, locale);
    case 'full':
    default:
      return new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
  }
}

export function toUTCISOString(localDateString: string, timezone?: string): string {
  const tz = timezone ?? getUserTimezone();
  const match = localDateString.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) {
    const parsed = new Date(localDateString);
    assertValidDate(parsed, localDateString);
    return parsed.toISOString();
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? '0');
  const minute = Number(match[5] ?? '0');
  const second = Number(match[6] ?? '0');

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimezoneOffsetMs(tz, new Date(naiveUtc));
  const adjustedUtc = naiveUtc - firstOffset;
  const secondOffset = getTimezoneOffsetMs(tz, new Date(adjustedUtc));
  const finalUtc = naiveUtc - secondOffset;

  return new Date(finalUtc).toISOString();
}

export function utcToLocalInput(isoString: string): string {
  const date = new Date(isoString);
  assertValidDate(date, isoString);

  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: getUserTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function subtractDays(days: number, from?: Date): Date {
  const source = from ? new Date(from) : new Date();
  source.setDate(source.getDate() - days);
  return source;
}

export function formatDateForApi(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateShort(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale ?? getDefaultLocale(), {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatRelative(date: Date, locale?: string): string {
  const now = Date.now();
  const diff = (date.getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale ?? getDefaultLocale(), { numeric: 'auto' });

  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diff / 86400), 'day');
  return rtf.format(Math.round(diff / 2592000), 'month');
}

function getTimezoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const tzName = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = tzName.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes) * 60 * 1000;
}
