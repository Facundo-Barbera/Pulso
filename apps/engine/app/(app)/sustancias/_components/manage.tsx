"use client";

import type { Substance, SubstanceInput } from "@pulso/contract";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "../../../_ui/fields";
import { send } from "../../../_ui/send";
import { Sheet } from "../../../_ui/sheet";
import { emojiOf, UNIT_SUGGESTIONS } from "./labels";

/** «Gestionar»: add a substance, edit, archive (history kept) or bring one back, and reorder. Nothing is ever deleted. */
export function ManageButton({ substances }: { substances: Substance[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Settings2 className="size-4" /> Gestionar
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Tus sustancias">
        <Manager substances={substances} />
      </Sheet>
    </>
  );
}

type Editing = { id: string | null; name: string; symbol: string; unit: string; forms: string };
const blank: Editing = { id: null, name: "", symbol: "", unit: "veces", forms: "" };
const editingOf = (s: Substance): Editing => ({ id: s.id, name: s.name, symbol: emojiOf(s) ?? "", unit: s.unit, forms: s.forms.join(", ") });

function Manager({ substances }: { substances: Substance[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = substances.filter((s) => !s.archived);
  const archived = substances.filter((s) => s.archived);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const move = (index: number, by: -1 | 1) => {
    const ids = active.map((s) => s.id);
    [ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!];
    run(() => send("/api/web/sustancias/tipos/orden", "PUT", { ids }));
  };

  if (editing) {
    return (
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const forms = editing.forms.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
          const input: SubstanceInput = { name: editing.name, symbol: editing.symbol.trim() || null, unit: editing.unit.trim() || "veces", forms };
          const ok = await run(() => (editing.id ? send(`/api/web/sustancias/tipos/${editing.id}`, "PATCH", input) : send("/api/web/sustancias/tipos", "POST", input)));
          if (ok) setEditing(null);
        }}
      >
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field label="Nombre">
            <input required maxLength={40} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} autoFocus />
          </Field>
          <Field label="Emoji">
            <input maxLength={8} value={editing.symbol} onChange={(e) => setEditing({ ...editing, symbol: e.target.value })} className={inputClass} placeholder="—" />
          </Field>
        </div>
        <Field label="Unidad" hint="Lo que cuentas cuando registras: sesiones, mg, ml, unidades, tragos…">
          <input required maxLength={20} list="substance-units" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} className={inputClass} />
          <datalist id="substance-units">
            {UNIT_SUGGESTIONS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label="Formas (opcional)" hint="Separadas por comas, en el orden que quieras: la primera es la de siempre.">
          <input maxLength={200} value={editing.forms} onChange={(e) => setEditing({ ...editing, forms: e.target.value })} className={inputClass} placeholder="fumado, vapeado, comestible" />
        </Field>
        {error && <p className="text-destructive text-[13px]">{error}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={busy} className="ml-auto">
            {editing.id ? "Guardar" : "Crear"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <ul className="-mx-2 space-y-0.5">
        {active.map((s, i) => (
          <li key={s.id} className="flex min-h-12 items-center gap-1 rounded-xl px-2">
            <span className="min-w-0 flex-1 truncate text-[14px]">
              {emojiOf(s) && <span className="mr-1.5">{emojiOf(s)}</span>}
              {s.name}
              <span className="text-muted-foreground"> · {s.unit}</span>
            </span>
            <IconButton label={`Subir ${s.name}`} disabled={busy || i === 0} onClick={() => move(i, -1)} icon={ArrowUp} />
            <IconButton label={`Bajar ${s.name}`} disabled={busy || i === active.length - 1} onClick={() => move(i, 1)} icon={ArrowDown} />
            <IconButton label={`Editar ${s.name}`} disabled={busy} onClick={() => setEditing(editingOf(s))} icon={Pencil} />
            <IconButton label={`Archivar ${s.name}`} disabled={busy} onClick={() => run(() => send(`/api/web/sustancias/tipos/${s.id}`, "PATCH", { archived: true }))} icon={Archive} />
          </li>
        ))}
      </ul>
      <Button className="mt-3" onClick={() => setEditing(blank)}>
        <Plus className="size-4" /> Nueva sustancia
      </Button>
      {archived.length > 0 && (
        <div className="border-border mt-6 border-t pt-4">
          <p className="text-muted-foreground mb-2 text-[12px] font-medium">Archivadas · su historial se conserva</p>
          <ul className="-mx-2 space-y-0.5">
            {archived.map((s) => (
              <li key={s.id} className="flex min-h-11 items-center gap-1 rounded-xl px-2">
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-[14px]">{s.name}</span>
                <IconButton label={`Recuperar ${s.name}`} disabled={busy} onClick={() => run(() => send(`/api/web/sustancias/tipos/${s.id}`, "PATCH", { archived: false }))} icon={ArchiveRestore} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
    </div>
  );
}

function IconButton({ label, icon: Icon, onClick, disabled }: { label: string; icon: typeof Pencil; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-9 place-items-center rounded-lg outline-none focus-visible:ring-2 disabled:opacity-30">
      <Icon className="size-4" />
    </button>
  );
}
