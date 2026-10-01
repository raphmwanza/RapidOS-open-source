import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import LayoutWrapper from "@/components/LayoutWrapper";
import I18nProvider from "@/components/I18nProvider";
import { LOCALE_COOKIE, loadMessages, localeDir, localeFromAcceptLanguage, normalizeLocale } from "@/lib/i18n";
import { MARKETING_HEADER } from "@/lib/marketing/paths";
import { SITE } from "@/config/site";

// latin-ext/vietnamese cover the accented Latin-script locales; other scripts
// (Arabic, Devanagari, Bengali, Ethiopic) use the system font fallback.
const inter = Inter({ subsets: ["latin", "latin-ext", "vietnamese"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.name, template: `%s | ${SITE.name}` },
  // Without an explicit icon the browser requests /favicon.ico, which 404s.
  icons: { icon: "/assets/images/icon.png" },
  description: SITE.description,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // UI language: explicit cookie (set by the language switcher or the user's
  // account preference) first, then the browser's Accept-Language header.
  const cookieLocale = normalizeLocale(cookies().get(LOCALE_COOKIE)?.value);
  const locale = cookieLocale ?? localeFromAcceptLanguage(headers().get("accept-language"));
  // English is bundled with the client; other dictionaries are sent with the page.
  const messages = locale === "en" ? undefined : await loadMessages(locale);
  // The marketing site (landing, docs, pricing) is English only; browsers may auto-translate it.
  const marketing = headers().get(MARKETING_HEADER) === "1";

  return (
    <html lang={marketing ? "en" : locale} dir={marketing ? "ltr" : localeDir(locale)}>
      <body className={inter.className}>
        <I18nProvider initialLocale={locale} initialMessages={messages} hasCookie={Boolean(cookieLocale)}>
          <AuthProvider>
            <LayoutWrapper>
              {children}
            </LayoutWrapper>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
