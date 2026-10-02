import { redirect } from "next/navigation";

type Props = { searchParams: Promise<{ q?: string; responder?: string }> };

/** Old "new chat" links: the same asks go to the one conversation. */
export default async function OldNewChat({ searchParams }: Props): Promise<never> {
  const { q, responder } = await searchParams;
  const params = new URLSearchParams({ ...(q ? { q } : {}), ...(responder ? { responder } : {}) }).toString();
  redirect(params ? `/coach?${params}` : "/coach");
}
