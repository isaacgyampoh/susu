/**
 * Just enough of Deno's globals for `npm run check:edge` to type-check these
 * functions with the TypeScript compiler that already ships with the project.
 *
 * This is NOT a Deno type definition and is not used at runtime — Supabase
 * provides the real ones when the function is deployed. It exists so the
 * checker stops reporting `Cannot find name 'Deno'` forty times and the
 * genuinely undefined identifiers are visible.
 */
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
