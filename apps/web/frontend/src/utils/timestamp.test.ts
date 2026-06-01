import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatToDisplay,
  getNow,
  getUserTimezone,
  isValidTimestamp,
  toUTCISOString,
  utcToLocalInput,
} from './timestamp';

const OriginalDateTimeFormat = Intl.DateTimeFormat;

function mockTimezone(timeZone: string): void {
  const Mocked = function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): Intl.DateTimeFormat {
    const formatter = new OriginalDateTimeFormat(locales, options);
    const resolved = formatter.resolvedOptions.bind(formatter);
    formatter.resolvedOptions = () => ({ ...resolved(), timeZone });
    return formatter;
  } as unknown as typeof Intl.DateTimeFormat;

  Mocked.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
  Intl.DateTimeFormat = Mocked;
}

describe('timestamp utils', () => {
  afterEach(() => {
    Intl.DateTimeFormat = OriginalDateTimeFormat;
    vi.restoreAllMocks();
  });

  it('getNow returns UTC ISO ending with Z', () => {
    expect(getNow().endsWith('Z')).toBe(true);
  });

  it('getNow output is parseable', () => {
    expect(Number.isNaN(new Date(getNow()).getTime())).toBe(false);
  });

  it('formatToDisplay converts UTC to Asia/Ho_Chi_Minh correctly', () => {
    mockTimezone('Asia/Ho_Chi_Minh');
    const output = formatToDisplay('2024-01-01T00:00:00.000Z', {
      format: 'full',
      locale: 'en-GB',
    });
    expect(output).toContain('Jan 2024');
    expect(output).toContain('07:00');
  });

  it('formatToDisplay supports relative format with mocked Date.now', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2024-01-01T00:05:00.000Z').getTime());
    const output = formatToDisplay('2024-01-01T00:00:00.000Z', {
      format: 'relative',
      locale: 'en',
    });
    expect(output).toContain('5 minute');
  });

  it('toUTCISOString round-trip keeps local input time in selected timezone', () => {
    mockTimezone('Pacific/Auckland');
    const utc = toUTCISOString('2024-01-01T12:30:00', 'Pacific/Auckland');
    const localInput = utcToLocalInput(utc);
    expect(localInput).toBe('2024-01-01T12:30');
  });

  it('getUserTimezone returns a supported IANA timezone', () => {
    const tz = getUserTimezone();
    const supportedValuesOf = (Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    }).supportedValuesOf;
    const supported = typeof supportedValuesOf === 'function'
      ? supportedValuesOf('timeZone')
      : [tz];
    expect(supported.includes(tz)).toBe(true);
  });

  it('isValidTimestamp rejects timestamps without timezone', () => {
    expect(isValidTimestamp('2024-03-15 08:30:00')).toBe(false);
    expect(isValidTimestamp('2024-03-15T08:30:00.000Z')).toBe(true);
  });

  it.each(['Asia/Ho_Chi_Minh', 'America/New_York', 'Pacific/Auckland', 'UTC'])(
    'formats date with mocked timezone %s',
    (tz) => {
      mockTimezone(tz);
      const output = formatToDisplay('2024-01-01T00:00:00.000Z', {
        format: 'time',
        locale: 'en-GB',
      });
      expect(output.length).toBeGreaterThanOrEqual(4);
    },
  );
});
