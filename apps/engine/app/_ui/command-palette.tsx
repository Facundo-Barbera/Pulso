"use client";

import { CircleDashed, CornerDownLeft, Link2, Moon, Search, SquarePen, Sun, SunMoon, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { readAppearance, saveAppearance, type Appearance } from "./appearance";
import { cn } from "./cn";
import { SECTIONS } from "./sections";

type Item = { id: string; label: string; hint: string; icon: LucideIcon; color?: string; run: () => void };

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * ⌘K: jump to a section or run a quick action. A native <dialog>, so focus trapping and Escape come free.
 * Sustancias is listed only on a browser that shows it; it is never in the sidebar.
 */
export function CommandPalette({ open, onClose, substances = false }: { open: boolean; onClose: () => void; substances?: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const items = useMemo<Item[]>(() => {
    const theme = (value: Appearance["theme"]) => () => saveAppearance({ ...readAppearance(), theme: value });
    return [
      ...SECTIONS.map((s, i) => ({ id: s.href, label: s.label, hint: `⌘${i + 1}`, icon: s.icon, color: s.color, run: () => router.push(s.href) })),
      { id: "coach-new", label: "Preguntar al Coach", hint: "Coach", icon: SquarePen, color: "var(--pulso-violet)", run: () => router.push("/coach") },
      ...(substances ? [{ id: "substances", label: "Sustancias", hint: "Privado", icon: CircleDashed, color: "var(--domain-medication)", run: () => router.push("/sustancias") }] : []),
      { id: "pair", label: "Emparejar un navegador", hint: "Ajustes", icon: Link2, run: () => router.push("/ajustes#emparejar") },
      { id: "dark", label: "Tema oscuro", hint: "Apariencia", icon: Moon, run: theme("dark") },
      { id: "light", label: "Tema claro", hint: "Apariencia", icon: Sun, run: theme("light") },
      { id: "system", label: "Tema del sistema", hint: "Apariencia", icon: SunMoon, run: theme("system") },
    ];
  }, [router, substances]);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    return q ? items.filter((item) => normalize(item.label).includes(q) || normalize(item.hint).includes(q)) : items;
  }, [items, query]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery("");
      setSelected(0);
      element.showModal();
    } else if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  function choose(item: Item | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="bg-popover text-popover-foreground shadow-3 border-border backdrop:bg-overlay m-auto mt-[12vh] w-[min(560px,calc(100vw-24px))] overflow-hidden rounded-2xl border p-0 backdrop:backdrop-blur-xs"
      aria-label="Buscar y saltar"
    >
      <div className="border-border flex items-center gap-3 border-b px-4">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(matches[selected]);
            }
          }}
          placeholder="Ir a una sección o hacer algo…"
          className="placeholder:text-muted-foreground h-14 flex-1 bg-transparent text-[15px] outline-none"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={matches[selected] ? `palette-${matches[selected].id}` : undefined}
        />
        <kbd className="border-border text-muted-foreground rounded border px-1.5 font-sans text-[11px]">esc</kbd>
      </div>
      <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
        {matches.length === 0 && <li className="text-muted-foreground px-3 py-8 text-center text-sm">Nada coincide con «{query}».</li>}
        {matches.map((item, i) => {
          const Icon = item.icon;
          return (
            <li
              key={item.id}
              id={`palette-${item.id}`}
              role="option"
              aria-selected={i === selected}
              onMouseMove={() => setSelected(i)}
              onClick={() => choose(item)}
              className={cn("flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-[14px]", i === selected && "bg-accent")}
            >
              <Icon className="size-[18px] shrink-0" style={{ color: item.color ?? "var(--muted-foreground)" }} />
              <span className="flex-1">{item.label}</span>
              <span className="text-muted-foreground text-[12px]">{item.hint}</span>
              {i === selected && <CornerDownLeft className="text-muted-foreground size-3.5" />}
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}
