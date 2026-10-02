"use client";

import { Command, Ellipsis, Laptop, Monitor, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CommandPalette } from "./command-palette";
import { cn } from "./cn";
import { PulsoMark } from "./pulso-mark";
import { GROUPS, isActive, SECTIONS, type Section } from "./sections";

export const SIDEBAR_COOKIE = "pulso_sidebar";

export type Who = { local: boolean; name: string | null };

/**
 * The frame every page sits in: a sidebar on wide screens (collapsible to an
 * icon rail, remembered in a cookie so the server renders it right and nothing
 * shifts), a bottom tab bar on narrow ones, ⌘1–⌘9 for the sections, ⌘K for
 * the command palette and ⌘\ to fold the sidebar.
 */
export function Shell({ collapsed: initiallyCollapsed, who, children }: { collapsed: boolean; who: Who; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [palette, setPalette] = useState(false);

  const toggle = useCallback(() => {
    setCollapsed((was) => {
      document.cookie = `${SIDEBAR_COOKIE}=${was ? "0" : "1"}; Path=/; Max-Age=31536000; SameSite=Lax`;
      return !was;
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < SECTIONS.length) {
        event.preventDefault();
        router.push(SECTIONS[index]!.href);
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (event.key === "\\") {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggle]);

  return (
    <div className="flex h-full">
      <aside
        className={cn(
          "app-ground bg-sidebar text-sidebar-foreground border-sidebar-border hidden shrink-0 flex-col border-r md:flex",
          "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out",
        )}
        style={{ width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)" }}
      >
        <div
          className={cn("app-drag flex h-[var(--titlebar-height)] shrink-0 items-center gap-2.5 pr-3", collapsed ? "justify-center px-0" : "")}
          style={collapsed ? undefined : { paddingLeft: "max(18px, var(--titlebar-inset))" }}
        >
          {/* In the Mac window the traffic lights own the collapsed rail's header. */}
          <Link href="/" className={cn("app-no-drag flex items-center gap-2.5 rounded-md", collapsed && "in-data-[telar-shell=macos]:hidden")} aria-label="Pulso, Hoy">
            <PulsoMark className="size-6" />
            {!collapsed && <span className="text-[15px] font-semibold tracking-tight">Pulso</span>}
          </Link>
          {!collapsed && (
            <button onClick={toggle} className="app-no-drag text-muted-foreground hover:text-foreground hover:bg-sidebar-accent focus-visible:ring-ring ml-auto grid size-8 place-items-center rounded-md outline-none focus-visible:ring-2" aria-label="Plegar la barra lateral (⌘\)" title="Plegar (⌘\)">
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-3 pt-1" aria-label="Secciones">
          {GROUPS.map((group, g) => {
            const rows = SECTIONS.filter((s) => s.group === group.id);
            if (rows.length === 0) return null;
            return (
              <section key={group.id} aria-labelledby={`nav-${group.id}`} className={cn("flex flex-col gap-0.5", g > 0 && (collapsed ? "mt-2" : "mt-4"))}>
                {/* Folded, a hairline stands in for the heading. */}
                {collapsed && g > 0 && <span className="bg-sidebar-border mx-auto mb-2 h-px w-6" aria-hidden />}
                <h2 id={`nav-${group.id}`} className={cn("text-muted-foreground/80 px-2.5 pb-1 text-[11px] font-semibold tracking-wide uppercase", collapsed && "sr-only")}>
                  {group.label}
                </h2>
                {rows.map((section) => (
                  <SidebarRow key={section.href} section={section} index={SECTIONS.indexOf(section)} active={isActive(section.href, pathname)} collapsed={collapsed} />
                ))}
              </section>
            );
          })}
        </nav>

        <div className={cn("flex shrink-0 flex-col gap-1 p-3", collapsed && "items-center")}>
          {SECTIONS.filter((s) => !s.group).map((section) => (
            <SidebarRow key={section.href} section={section} index={SECTIONS.indexOf(section)} active={isActive(section.href, pathname)} collapsed={collapsed} />
          ))}
          <button
            onClick={() => setPalette(true)}
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent focus-visible:ring-ring flex h-9 items-center gap-2.5 rounded-lg text-[13px] outline-none focus-visible:ring-2",
              collapsed ? "w-10 justify-center" : "px-2.5",
            )}
            title="Buscar y saltar (⌘K)"
          >
            <Command className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span>Buscar</span>
                <kbd className="border-border bg-background/60 ml-auto rounded border px-1.5 font-sans text-[11px]">⌘K</kbd>
              </>
            )}
          </button>
          <div className={cn("text-muted-foreground flex h-9 items-center gap-2.5 text-[12px]", collapsed ? "justify-center" : "px-2.5")} title={who.local ? "Esta Mac" : `Navegador emparejado: ${who.name ?? ""}`}>
            {who.local ? <Monitor className="size-4 shrink-0" /> : <Laptop className="size-4 shrink-0" />}
            {!collapsed && <span className="truncate">{who.local ? "Esta Mac" : (who.name ?? "Navegador emparejado")}</span>}
          </div>
          {collapsed && (
            <button onClick={toggle} className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent focus-visible:ring-ring grid size-10 place-items-center rounded-lg outline-none focus-visible:ring-2" aria-label="Desplegar la barra lateral (⌘\)" title="Desplegar (⌘\)">
              <PanelLeftOpen className="size-4" />
            </button>
          )}
        </div>
      </aside>

      <main id="main" className="bg-background relative min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {/* The Mac window drags by its top band, as a native one does. */}
        <div className="app-drag absolute inset-x-0 top-0 hidden h-[var(--titlebar-height)] in-data-[telar-shell=macos]:block" aria-hidden />
        {children}
      </main>

      <TabBar pathname={pathname} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function SidebarRow({ section, index, active, collapsed }: { section: Section; index: number; active: boolean; collapsed: boolean }) {
  const Icon = section.icon;
  return (
    <Link
      href={section.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? `${section.label} (⌘${index + 1})` : undefined}
      className={cn(
        "group focus-visible:ring-ring relative flex h-9 items-center gap-3 rounded-lg text-[14px] outline-none focus-visible:ring-2",
        collapsed ? "mx-auto w-10 justify-center" : "px-2.5",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-1 font-medium" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-[18px] shrink-0 transition-colors" style={active ? { color: section.color } : undefined} strokeWidth={active ? 2.2 : 1.8} />
      {!collapsed && (
        <>
          <span className="truncate">{section.label}</span>
          <kbd className="text-muted-foreground/70 ml-auto font-sans text-[11px] opacity-0 transition-opacity group-hover:opacity-100">⌘{index + 1}</kbd>
        </>
      )}
    </Link>
  );
}

/** The phone browser's bar: the four main sections and «Más» for the rest, like the iOS app. */
function TabBar({ pathname }: { pathname: string }) {
  const [more, setMore] = useState(false);
  const tabs = SECTIONS.filter((s) => s.tab);
  const rest = SECTIONS.filter((s) => !s.tab);
  const inRest = rest.some((s) => isActive(s.href, pathname));
  useEffect(() => setMore(false), [pathname]);

  return (
    <>
      {more && (
        <div className="bg-overlay fixed inset-0 z-40 backdrop-blur-xs md:hidden" onClick={() => setMore(false)}>
          <div className="bg-popover text-popover-foreground shadow-3 pb-safe absolute inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] rounded-3xl p-2" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Más secciones">
            <div className="flex items-center justify-between px-3 pt-1 pb-2">
              <span className="text-muted-foreground text-[13px] font-medium">Más</span>
              <button onClick={() => setMore(false)} className="text-muted-foreground grid size-11 place-items-center rounded-full" aria-label="Cerrar">
                <X className="size-5" />
              </button>
            </div>
            {rest.map((section) => {
              const Icon = section.icon;
              const active = isActive(section.href, pathname);
              return (
                <Link key={section.href} href={section.href} className={cn("flex min-h-12 items-center gap-3 rounded-2xl px-3 text-[16px]", active && "bg-accent font-medium")}>
                  <span className="grid size-8 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${section.color} 18%, transparent)`, color: section.color }}>
                    <Icon className="size-[18px]" />
                  </span>
                  {section.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
      <nav className="border-border bg-background/80 pb-safe fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-xl md:hidden" aria-label="Secciones">
        <div className="mx-auto flex h-[60px] max-w-lg items-stretch justify-around px-2">
          {tabs.map((section) => (
            <TabButton key={section.href} label={section.label} icon={section.icon} color={section.color} active={isActive(section.href, pathname)} href={section.href} />
          ))}
          <button onClick={() => setMore((open) => !open)} className={cn("flex min-w-16 flex-col items-center justify-center gap-0.5 text-[11px]", inRest || more ? "text-foreground font-medium" : "text-muted-foreground")} aria-expanded={more}>
            <Ellipsis className="size-6" strokeWidth={inRest ? 2.2 : 1.8} />
            Más
          </button>
        </div>
      </nav>
    </>
  );
}

function TabButton({ label, icon: Icon, color, active, href }: { label: string; icon: Section["icon"]; color: string; active: boolean; href: string }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex min-w-16 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "font-medium" : "text-muted-foreground")} style={active ? { color } : undefined}>
      <Icon className="size-6" strokeWidth={active ? 2.2 : 1.8} />
      {label}
    </Link>
  );
}
