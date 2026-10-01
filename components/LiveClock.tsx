'use client';

import { useEffect, useState } from 'react';

export default function LiveClock({
  locale,
  options = { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  className = ''
}: {
  locale?: string;
  options?: Intl.DateTimeFormatOptions;
  className?: string;
}) {
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className={className}>{now.toLocaleTimeString(locale, options)}</span>;
}
