// Server-side environment lookups that are resolved when the request runs.
//
// Next.js replaces every literal `process.env.NEXT_PUBLIC_*` with its build-time
// value, in server code as well as in the browser bundle. When the image is
// built without those variables (Docker, Railway) the reference stays dynamic,
// but a build that does see them (a host build with a .env file, a builder that
// exposes service variables at build time) bakes them in for good, and changing
// the variable on the host afterwards has no effect. Reading through a computed
// key is never inlined, so the value always comes from the running container.

/** Value of an environment variable at runtime, or undefined when unset or blank. */
export function runtimeEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

/** First variable among `names` that is set at runtime. */
export function firstRuntimeEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name);
    if (value !== undefined) return value;
  }
  return undefined;
}
