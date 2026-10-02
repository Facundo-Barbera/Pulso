import { redirect } from "next/navigation";

/** Old links to a thread: there is one conversation now. */
export default function OldThread(): never {
  redirect("/coach");
}
