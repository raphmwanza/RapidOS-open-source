import Image from 'next/image';
import { SCREENSHOTS, type ScreenshotId } from '@/lib/marketing/screenshots';

interface ScreenshotProps {
  id: ScreenshotId;
  caption?: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}

/** A real dashboard screenshot in a browser-like frame. */
export default function Screenshot({ id, caption, priority, className = '', sizes = '(min-width: 1024px) 880px, 100vw' }: ScreenshotProps) {
  const shot = SCREENSHOTS[id];
  return (
    <figure className={`my-6 ${className}`}>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg shadow-gray-900/5">
        <div className="flex items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-3 py-2" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
        </div>
        <Image src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} sizes={sizes} priority={priority} className="h-auto w-full" />
      </div>
      {caption && <figcaption className="mt-2 text-center text-sm text-gray-500">{caption}</figcaption>}
    </figure>
  );
}
