import { headers } from "next/headers";
import { callerOf } from "@/src/device-auth";
import { fromTailnet } from "@/src/tailnet-gate";

/** Whoever may write: the Mac itself, or a paired browser holding `edit`. The gate enforces it again on every write. */
export async function canEdit(): Promise<boolean> {
  const head = await headers();
  return !fromTailnet(head) || (callerOf(head).device?.scopes.includes("edit") ?? false);
}
