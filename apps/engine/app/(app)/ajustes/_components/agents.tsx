"use client";

import type { McpClientCreated, McpEndpoint, McpScope } from "@pulso/contract";
import { Bot, Check, Copy, KeyRound, Lock, LockOpen, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentClient, AgentsOverview } from "@/src/web/agents";
import { cn } from "../../../_ui/cn";
import { EmptyState } from "../../../_ui/empty-state";
import { fmtAgo, fmtShortDate, fmtTime } from "../../../_ui/format";

const SCOPES: { scope: McpScope; label: string }[] = [
  { scope: "read", label: "Sólo lectura" },
  { scope: "read+write", label: "Lectura y escritura" },
];

const OUTCOME: Record<AgentClient["recent"][number]["outcome"], { label: string; className: string }> = {
  ok: { label: "bien", className: "text-muted-foreground" },
  error: { label: "error", className: "text-warning" },
  refused: { label: "rechazada", className: "text-destructive" },
};

async function failure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? `Algo falló (${response.status}).`;
}

/** External agents that use Pulso's tools over MCP: create one (its secret shown once), change its scope, revoke it, see what it called. The Mac only. */
export function AgentsPanel({ overview }: { overview: AgentsOverview }) {
  const router = useRouter();
  const [created, setCreated] = useState<McpClientCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = overview.clients.filter((c) => !c.revokedAt);
  const revoked = overview.clients.filter((c) => c.revokedAt);

  async function call(url: string, init: RequestInit): Promise<Response | null> {
    setError(null);
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
    if (!response.ok) {
      setError(await failure(response));
      return null;
    }
    router.refresh();
    return response;
  }

  async function create(name: string, scope: McpScope): Promise<boolean> {
    const response = await call("/api/web/admin/mcp/clients", { method: "POST", body: JSON.stringify({ name, scope }) });
    if (response) setCreated((await response.json()) as McpClientCreated);
    return response !== null;
  }

  return (
    <div>
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Otros agentes — Claude Code, Telar, Delta — pueden usar las herramientas de Pulso por MCP, cada uno con su propia llave. Empiezan en sólo lectura ({overview.tools.read} herramientas); con escritura ven también las {overview.tools.write} que registran o cambian datos. Sustancias ({overview.tools.sensitive}) queda oculto para todos salvo que actives «Datos sensibles» en uno.
      </p>

      {created ? <Secret created={created} onDone={() => setCreated(null)} /> : <CreateForm onCreate={create} />}
      {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}

      <div className="mt-6">
        {live.length === 0 ? (
          <EmptyState compact icon={Bot} color="var(--pulso-violet)" title="Ningún agente conectado" line="Crea uno arriba y pega su configuración en el agente que quieras conectar." />
        ) : (
          <ul className="space-y-2.5">
            {live.map((client) => (
              <ClientRow
                key={client.id}
                client={client}
                onScope={(scope) => call(`/api/web/admin/mcp/clients/${client.id}`, { method: "PATCH", body: JSON.stringify({ scope }) })}
                onSensitive={(sensitive) => call(`/api/web/admin/mcp/clients/${client.id}`, { method: "PATCH", body: JSON.stringify({ sensitive }) })}
                onRevoke={() => call(`/api/web/admin/mcp/clients/${client.id}`, { method: "DELETE" })}
              />
            ))}
          </ul>
        )}
        {revoked.length > 0 && (
          <details className="text-muted-foreground mt-4 text-[13px]">
            <summary className="min-h-9 cursor-pointer py-2">{revoked.length === 1 ? "1 revocado" : `${revoked.length} revocados`}</summary>
            <ul className="mt-1 space-y-1">
              {revoked.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-1">
                  <span className="text-foreground/70 truncate">{c.name}</span>
                  <span className="text-[12px]">· revocado el {fmtShortDate(c.revokedAt!)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function CreateForm({ onCreate }: { onCreate: (name: string, scope: McpScope) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<McpScope>("read");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await onCreate(name, scope)) setName("");
        setBusy(false);
      }}
    >
      <label className="min-w-48 flex-1">
        <span className="text-muted-foreground text-[12px] font-medium">Nombre del agente</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Claude Code, Telar…" className="bg-background border-border focus-visible:ring-ring mt-1 min-h-11 w-full rounded-xl border px-3 text-[14px] outline-none focus-visible:ring-2" />
      </label>
      <ScopeToggle scope={scope} onChange={setScope} />
      <button type="submit" disabled={!name.trim() || busy} className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-11 shrink-0 rounded-xl px-4 text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50">
        {busy ? "Creando…" : "Crear llave"}
      </button>
    </form>
  );
}

function ScopeToggle({ scope, onChange, disabled }: { scope: McpScope; onChange: (scope: McpScope) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Alcance" className="bg-muted flex shrink-0 rounded-xl p-1">
      {SCOPES.map((s) => (
        <button
          key={s.scope}
          type="button"
          role="radio"
          aria-checked={scope === s.scope}
          disabled={disabled}
          onClick={() => scope !== s.scope && onChange(s.scope)}
          className={cn("focus-visible:ring-ring min-h-9 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 disabled:opacity-60", scope === s.scope ? "bg-card shadow-1" : "text-muted-foreground hover:text-foreground")}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** The secret, once: copy it with the endpoint for this Mac and for the tailnet. */
function Secret({ created, onDone }: { created: McpClientCreated; onDone: () => void }) {
  const { connection } = created;
  return (
    <div className="border-warning/40 bg-warning/8 mt-4 rounded-2xl border p-4" aria-live="polite">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <KeyRound className="text-warning size-4" /> Llave de «{created.client.name}»
      </p>
      <p className="text-muted-foreground mt-1 text-[13px]">Cópiala ahora: Pulso sólo guarda su huella y no la vuelve a mostrar.</p>
      <CopyLine label="Llave" value={created.secret} />
      <Endpoint label="En esta Mac" endpoint={connection.loopback} />
      {connection.tailnet ? (
        <Endpoint label="Desde el tailnet (con bun run tailnet)" endpoint={connection.tailnet} />
      ) : (
        <p className="text-muted-foreground mt-3 text-[12px]">Esta Mac no tiene IP de Tailscale: por ahora sólo la alcanzan agentes que corren aquí.</p>
      )}
      <button onClick={onDone} className="border-border hover:bg-muted/60 mt-4 min-h-10 rounded-xl border px-4 text-[13px] font-medium">
        Ya la copié
      </button>
    </div>
  );
}

function Endpoint({ label, endpoint }: { label: string; endpoint: McpEndpoint }) {
  return (
    <div className="mt-3">
      <p className="text-muted-foreground text-[12px] font-medium">{label}</p>
      <CopyLine value={endpoint.url} />
      <CopyLine value={endpoint.claudeCode} hint="Claude Code" />
    </div>
  );
}

function CopyLine({ label, value, hint }: { label?: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1.5">
      {label && <p className="text-muted-foreground mb-1 text-[12px] font-medium">{label}</p>}
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        className="bg-background hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2"
        title="Copiar"
      >
        {hint && <span className="text-muted-foreground shrink-0 text-[11px]">{hint}</span>}
        <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{value}</code>
        {copied ? <Check className="text-success size-3.5 shrink-0" /> : <Copy className="text-muted-foreground size-3.5 shrink-0" />}
      </button>
    </div>
  );
}

function ClientRow({
  client,
  onScope,
  onSensitive,
  onRevoke,
}: {
  client: AgentClient;
  onScope: (scope: McpScope) => Promise<unknown>;
  onSensitive: (sensitive: boolean) => Promise<unknown>;
  onRevoke: () => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await action();
    setBusy(false);
  };
  return (
    <li className="bg-muted/50 rounded-2xl p-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="bg-background grid size-9 shrink-0 place-items-center rounded-xl">
          <Bot className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{client.name}</span>
          {/* Relative time can tick between render and hydration. */}
          <span className="text-muted-foreground block truncate text-[12px]" suppressHydrationWarning>
            {client.lastUsedAt ? `usado ${fmtAgo(client.lastUsedAt)}` : "nunca usado"} · creado el {fmtShortDate(client.createdAt)}
            {client.refused > 0 && <span className="text-destructive"> · {client.refused === 1 ? "1 llamada rechazada" : `${client.refused} llamadas rechazadas`}</span>}
          </span>
        </span>
        <ScopeToggle scope={client.scope} disabled={busy} onChange={(scope) => run(() => onScope(scope))} />
        <button
          type="button"
          role="switch"
          aria-checked={client.sensitive}
          disabled={busy}
          onClick={() => run(() => onSensitive(!client.sensitive))}
          title={client.sensitive ? "Ve Sustancias. Pulsa para ocultarlo." : "No ve Sustancias. Pulsa para permitirlo."}
          className={cn(
            "focus-visible:ring-ring inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium outline-none focus-visible:ring-2 disabled:opacity-60",
            client.sensitive ? "bg-warning/15 text-warning" : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          {client.sensitive ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
          Datos sensibles
        </button>
        {confirming ? (
          <span className="flex gap-1.5">
            <button onClick={() => setConfirming(false)} className="hover:bg-muted min-h-9 rounded-lg px-2.5 text-[13px]">
              Cancelar
            </button>
            <button onClick={() => run(onRevoke)} disabled={busy} className="bg-destructive text-background min-h-9 rounded-lg px-2.5 text-[13px] font-medium">
              Revocar
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:ring-ring grid size-9 place-items-center rounded-lg outline-none focus-visible:ring-2" aria-label={`Revocar ${client.name}`} title="Revocar">
            <Unplug className="size-4" />
          </button>
        )}
      </div>
      {client.recent.length > 0 && (
        <ul className="border-border mt-3 flex flex-wrap gap-1.5 border-t pt-3" aria-label="Últimas llamadas">
          {client.recent.map((call) => (
            <li key={call.id} className={cn("bg-background rounded-md px-2 py-1 font-mono text-[11px]", OUTCOME[call.outcome].className)} title={`${fmtShortDate(call.at)} ${fmtTime(call.at)} · ${OUTCOME[call.outcome].label}`} suppressHydrationWarning>
              {call.tool}
              {call.outcome !== "ok" && <span className="font-sans"> · {OUTCOME[call.outcome].label}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
