/**
 * Pair this browser: the page an unpaired browser on the tailnet gets in place
 * of the app (`proxy.ts` rewrites to it). `GET` is a plain form — the 8-digit
 * code Ajustes shows on the Mac and a name for this device. `POST` trades them
 * for a device token, set as the HttpOnly cookie, and sends the browser on.
 * A route, not a page, on purpose: an unpaired browser gets none of the app's
 * chunks, so this answers with its own HTML and works without JavaScript.
 */
import { safeNext, setCookie } from "@/src/device-auth";
import { PairingError, redeemPairing } from "@/src/devices";

export const dynamic = "force-dynamic";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const MARK = `<svg viewBox="0 0 1024 1024" width="56" height="56" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7A45"/><stop offset=".5" stop-color="#F5335F"/><stop offset="1" stop-color="#8A2BE2"/></linearGradient></defs><rect width="1024" height="1024" rx="230" fill="url(#g)"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="64"><path d="M190 612H340L405 482L480 722L570 302L650 592L840 402"/><path d="M718 402H840V524"/></g></svg>`;

function page(next: string, error?: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light"><title>Emparejar con Pulso</title>
<style>
  :root { --bg: oklch(0.145 0 0); --card: oklch(0.2 0 0); --fg: oklch(0.97 0 0); --muted: oklch(0.708 0 0); --input: oklch(0.53 0 0); --border: oklch(1 0 0 / 10%); --primary: oklch(0.68 0.17 15); --on-primary: oklch(0.17 0.04 15); --error: oklch(0.7 0.19 25.5); }
  @media (prefers-color-scheme: light) { :root { --bg: oklch(0.975 0.002 286); --card: oklch(1 0 0); --fg: oklch(0.274 0.006 286); --muted: oklch(0.525 0.016 286); --input: oklch(0.645 0.008 286); --border: oklch(0.92 0.004 286); --primary: oklch(0.488 0.17 15); --on-primary: oklch(1 0 0); --error: oklch(0.5 0.19 25.5); } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--fg);
    font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
  form { width: min(360px, 100%); display: grid; gap: 14px; background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 28px;
    box-shadow: 0 24px 60px -30px rgb(0 0 0 / .5); }
  svg { display: block; margin-bottom: 4px; filter: drop-shadow(0 8px 18px rgb(245 51 95 / .35)); }
  h1 { font-size: 20px; margin: 0; letter-spacing: -.01em; } p { margin: 0; color: var(--muted); font-size: 14px; }
  label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
  input { font: inherit; color: var(--fg); background: transparent; padding: 11px 12px; border-radius: 12px; border: 1px solid var(--input); min-height: 44px; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  input[name=code] { font: 600 24px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .32em; text-align: center; font-variant-numeric: tabular-nums; }
  button { font: inherit; font-weight: 600; min-height: 44px; border: 0; border-radius: 12px; background: var(--primary); color: var(--on-primary); cursor: pointer; }
  .error { color: var(--error); }
</style></head>
<body><form method="post" action="/pair">
  ${MARK}
  <h1>Emparejar este navegador</h1>
  <p>En la Mac, abre Pulso › Ajustes › Emparejar › Navegador y escribe aquí el código.</p>
  ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
  <input type="hidden" name="next" value="${escape(next)}">
  <label>Código<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="00000000" required autofocus></label>
  <label>Nombre de este dispositivo<input name="name" maxlength="80" placeholder="MacBook, iPad…" autocomplete="off"></label>
  <button type="submit">Emparejar</button>
</form></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function GET(request: Request): Response {
  return page(safeNext(new URL(request.url).searchParams.get("next")));
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => undefined);
  const code = form?.get("code");
  const name = form?.get("name");
  const next = safeNext(form?.get("next"));
  if (typeof code !== "string") return page(next, "Escribe el código que muestra la Mac.", 400);
  try {
    const paired = redeemPairing({ code, name: typeof name === "string" ? name : "", kind: "browser" });
    return new Response(null, { status: 303, headers: { location: next, "set-cookie": setCookie(paired.token), "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PairingError) return page(next, error.message, error.code === "invalid_code" ? 400 : 401);
    throw error;
  }
}
