'use client';

import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { fetchDocumentBlob } from '@/lib/documentAccess';

/**
 * <img> for images served by the authenticated API (/api/...): fetched with
 * the admin's token and shown through an object URL. Other URLs are used as is.
 */
export default function AuthedImage({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const needsAuth = src.startsWith('/api/');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!needsAuth) return;
    let revoked = false;
    let url: string | null = null;
    setFailed(false);
    fetchDocumentBlob(src)
      .then((blob) => {
        if (revoked) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => !revoked && setFailed(true));
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, needsAuth]);

  if (needsAuth && !objectUrl) {
    return <div role="img" aria-label={alt} className={rest.className} style={{ ...rest.style, background: failed ? '#fee2e2' : '#f3f4f6' }} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={needsAuth ? objectUrl || '' : src} alt={alt} {...rest} />;
}
