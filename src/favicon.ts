/**
 * Browser-tab favicon, embedded directly in the Worker bundle.
 *
 * This repo has no Cloudflare Workers static-assets directory configured
 * (`wrangler.jsonc` has no `assets` field), so there is no filesystem for the
 * Worker to serve a PNG from at request time -- static assets is the
 * Cloudflare-native way to do that, but it changes request routing for every
 * path (static files are served ahead of the Worker script by default) and
 * would need mirroring into every tenant's wrangler config too. For two tiny,
 * never-changes-per-tenant images, embedding the bytes and returning them from
 * a normal route is the smaller, safer move -- same pattern this codebase
 * already uses to serve a generated invoice PDF (see the
 * `/invoices/:id/pdf` route in src/index.ts), just base64 instead of an
 * ArrayBuffer produced at request time.
 *
 * Source PNGs live at assets/icon/favicon/favicon-{32,48}.png, rendered from
 * assets/icon/tile.svg via rsvg-convert. If the mark or brand colors change,
 * regenerate the PNGs first, then refresh the constants below with:
 *
 *   base64 -i assets/icon/favicon/favicon-32.png -o /tmp/fav32.b64 && tr -d '\n' < /tmp/fav32.b64
 *   base64 -i assets/icon/favicon/favicon-48.png -o /tmp/fav48.b64 && tr -d '\n' < /tmp/fav48.b64
 */

export const FAVICON_32_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAABmJLR0QA/wD/AP+gvaeTAAABY0lEQVRIiWMUlZBjoCVgoqnpw8ICFoIqpAQYk63ZGAkpu/bs35rzv0m2QEqAcX4sl5QAQfMZ3qr/x2oBviCS5GecG8NJjOkMDAy4FOG0QJKfcV4sp4wgpZGEXT+1TGfAFQfTIrCYfvbR38UnfjEwMMRZsBnJMVNkgRA3epDeff0vdcn3338ZGBgYDt35vjadS1GYKP8RGwiH7/yFmM7AwPD7L8PBW3/xKifdAjFeFK4EH1FJiwQL3LVYndSh4emszuyqSTiHQgCx6piZGCaGcdx/+4+RgVFBmFjnk2ABBBAZschg2Jemn38wPPnw7/9/7LKMjAwyAky8HBRYwMbCwMNOQAF+QECenYVBlrISiYAF//8zfPmJLsjGwsBOdOojoPD9t/9Xnv37z4ASCbwcjEaylBV2cCDEzWinSqxZWMHQzwfYLcCR7vEBXFqwx8GU/b+0pEjz3NVn2GsIxtG26YBbAAAcQ01ZrMhB1gAAAABJRU5ErkJggg==';

export const FAVICON_48_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAABmJLR0QA/wD/AP+gvaeTAAACBUlEQVRYhe3YPU/bQBwG8Od855cAIV0KgQFUIVRo6NJKZEFiqtqhogsgBraqH4MpO6grElP7DRgyV0gsiI1WaiN1yJKmdKiTtnn3McCSKrmXXHAcyc+Wsy/3s+/vOyfkYXoBUYo1asD/iUGyxCBZ2AB9HIa95w7T71quBPmrdsCHCnIY3u96G0uDXAmAP/X6p0JbcILelNkUh9uDawCkEpITNEA2xdGOt7k8uEYlqqBwNFAEhaaBCihMDaQgRU3J5yVf+DQrRzLSyydMrPlSCg5OG9/KHQCPZ63clreaNlpsJZ0tIjparvJ3H2u3GgBfy8HbD/8Mb5XR1RyfNSv1ruGrdZycN0cG+v4r6NF43aNRPUag2ekeM9qzUT1GoP11m3VXGbPIftYeGWhtnua23Cn37mPSQ+6Nm5mjJt9puty9fso2liYvih0A64s0lTCaryGAADyYIC9WhraOR+6NMQbJEjmQdjGWfF5rqe5WCZvMpfSeOz1QO+CFnwGHKoiAzCQp1ZkGPRCzSPYRbYp+NXTFYdDSaIMAuAzufb48jn9R/23wVqfv0QmHOGb3T693J8BlUVTUSZc8Wwhxc6UWVtJWo90XlPJC31xnkgQwHVWQyBV1DJJl3EB+bcjj/a5J9kEi/uPcIniVsdOaO3a//PB5/nOLC0kSUPgZtxoKPzFIlsiBbgC39Xt334CmRwAAAABJRU5ErkJggg==';

/** Decode a base64-embedded PNG into a Response with the right headers. */
export function faviconResponse(base64: string): Response {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      // Same tiny image for every tenant; a day is plenty and short enough
      // that a future redesign doesn't need a cache-busting query param.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
