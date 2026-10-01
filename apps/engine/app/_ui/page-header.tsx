/** The top of a page: an eyebrow (date or context), a large title, one supporting line, actions on the right. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-4 pt-[calc(env(safe-area-inset-top)+20px)] pb-6 md:pt-[calc(var(--titlebar-height)+12px)] md:pb-8">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="text-muted-foreground mb-1.5 text-[13px] font-medium first-letter:uppercase">{eyebrow}</p>}
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight md:text-[34px]">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-2 max-w-2xl text-[15px] leading-relaxed">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The page column: max width, generous gutters, room for the phone's tab bar. */
export function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-5 pb-[calc(96px+env(safe-area-inset-bottom))] md:px-10 md:pb-16">{children}</div>;
}
