import { useEffect, useState } from 'react';
import { formatToDisplay, getUserTimezone, type DisplayFormat } from '@/utils/timestamp';

export function useFormattedTime(isoString: string, format: DisplayFormat = 'full'): string {
  const [timezone, setTimezone] = useState(getUserTimezone());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const current = getUserTimezone();
      setTimezone((prev) => (prev === current ? prev : current));
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, []);

  return formatToDisplay(isoString, { format });
}

