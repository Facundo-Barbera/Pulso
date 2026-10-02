"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Toggle } from "../../../_ui/fields";
import { send } from "../../../_ui/send";

/** This browser's own switch: Sustancias shows on the Mac by default and elsewhere only once turned on there. */
export function VisibilityToggle({ visible, local }: { visible: boolean; local: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(visible);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Toggle
        checked={on}
        label={local ? "Mostrar en esta Mac" : "Mostrar en este navegador"}
        hint={local ? "Visible aquí por defecto." : "Oculto por defecto en navegadores que no son la Mac."}
        onChange={async (next) => {
          setError(null);
          setOn(next);
          try {
            await send("/api/web/sustancias/visibilidad", "PUT", { visible: next });
            router.refresh();
          } catch (e) {
            setOn(!next);
            setError((e as Error).message);
          }
        }}
      />
      {error && <p className="text-destructive mt-2 text-[13px]">{error}</p>}
    </div>
  );
}
