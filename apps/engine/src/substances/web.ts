import { callerOf } from "../device-auth";
import { fromTailnet } from "../tailnet-gate";
import { MAC, visibleOn } from "./store";

type Headers = { get(name: string): string | null };

/** Which web client is asking, for Sustancias' per-browser switch: this Mac, a paired browser's id, or nobody. */
export function webKey(headers: Headers): string | null {
  if (!fromTailnet(headers)) return MAC;
  return callerOf(headers).device?.id ?? null;
}

/** Whether this web client shows Sustancias (on the Mac by default, elsewhere only once turned on there). */
export function shownHere(headers: Headers): boolean {
  const key = webKey(headers);
  return key !== null && visibleOn(key);
}
