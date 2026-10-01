/** A paired device: the iPhone app (bearer token) or a browser on the tailnet (HttpOnly cookie). */
export type DeviceKind = "phone" | "browser";

/**
 * What a device may reach from the tailnet:
 *   mobile  the phone API, `/api/mobile/*` (bearer)
 *   view    the web app's pages and `GET /api/web/*`
 *   edit    writes to `/api/web/*` and page actions
 * Admin (codes, the device list) has no scope: it answers on the Mac only.
 */
export type Scope = "mobile" | "view" | "edit";

export type PairedDevice = {
  id: string;
  name: string;
  kind: DeviceKind;
  scopes: Scope[];
  pairedAt: number;
  lastSeenAt: number | null;
};

/** `POST /api/web/admin/pair-code` body. A code pairs only the kind it was minted for. */
export type PairCodeRequest = { kind?: DeviceKind };

/** `GET /api/web/me`: who the web app is talking to. `device` is null on the Mac itself. */
export type WebMe = { local: boolean; device: PairedDevice | null };
