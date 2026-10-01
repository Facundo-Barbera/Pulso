import { cookies, headers } from "next/headers";
import { callerOf } from "@/src/device-auth";
import { fromTailnet } from "@/src/tailnet-gate";
import { Shell, SIDEBAR_COOKIE } from "../_ui/shell";

export const dynamic = "force-dynamic";

/** Every section shares the shell. The sidebar's folded state comes from a cookie so the first paint is already right. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const local = !fromTailnet(head);
  const name = local ? null : (callerOf(head).device?.name ?? null);
  return (
    <Shell collapsed={jar.get(SIDEBAR_COOKIE)?.value === "1"} who={{ local, name }}>
      {children}
    </Shell>
  );
}
