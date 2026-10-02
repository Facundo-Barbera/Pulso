import { Bot, ChevronRight, CircleDashed, Link2, MonitorSmartphone, Palette } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { callerOf } from "@/src/device-auth";
import { listDevices } from "@/src/devices";
import { shownHere } from "@/src/substances/web";
import { fromTailnet } from "@/src/tailnet-gate";
import { agentsOverview } from "@/src/web/agents";
import { Card, CardTitle } from "../../_ui/card";
import { Page, PageHeader } from "../../_ui/page-header";
import { AgentsPanel } from "./_components/agents";
import { AppearancePanel } from "./_components/appearance-panel";
import { DeviceList, ThisBrowser } from "./_components/devices";
import { PairPanel } from "./_components/pair-panel";
import { VisibilityToggle } from "../sustancias/_components/visibility";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ajustes" };

/**
 * Ajustes. Pairing, the device list and MCP agents are admin: they render,
 * and their routes answer, on the Mac only. A paired browser sees itself instead, and
 * can forget itself.
 */
export default async function Ajustes() {
  const head = await headers();
  const local = !fromTailnet(head);
  const me = local ? undefined : callerOf(head).device;
  const substances = shownHere(head);
  return (
    <Page>
      <PageHeader title="Ajustes" subtitle={local ? "Empareja el iPhone y otros navegadores, conecta otros agentes y elige cómo se ve Pulso." : "Este navegador está emparejado con la Mac que guarda tus datos."} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="scroll-mt-6" as="section">
          <div id="emparejar" className="scroll-mt-20" />
          <CardTitle icon={Link2} color="var(--primary)" title="Emparejar" />
          {local ? (
            <PairPanel />
          ) : (
            <p className="text-muted-foreground text-[14px] leading-relaxed">Los códigos se generan en la Mac: abre Pulso allí, ve a Ajustes › Emparejar y elige «Navegador» o «iPhone».</p>
          )}
        </Card>
        <Card delay={60}>
          <CardTitle icon={MonitorSmartphone} color="var(--domain-body)" title={local ? "Dispositivos" : "Este navegador"} />
          {local ? <DeviceList devices={listDevices()} /> : me ? <ThisBrowser device={me} /> : null}
        </Card>
        <Card delay={120} className="lg:col-span-2">
          <div id="agentes" className="scroll-mt-20" />
          <CardTitle icon={Bot} color="var(--pulso-violet)" title="Agentes (MCP)" />
          {local ? (
            <AgentsPanel overview={agentsOverview()} />
          ) : (
            <p className="text-muted-foreground text-[14px] leading-relaxed">Sólo desde la Mac. Las llaves de otros agentes se crean, cambian y revocan en la ventana de Pulso de la Mac, en Ajustes › Agentes.</p>
          )}
        </Card>
        <Card delay={180}>
          <CardTitle icon={CircleDashed} color="var(--domain-medication)" title="Sustancias" />
          <p className="text-muted-foreground mb-4 text-[13px] leading-relaxed">Un registro privado que no aparece en Hoy ni en el menú. Otros agentes no lo ven salvo que les des «Datos sensibles».</p>
          <VisibilityToggle visible={substances} local={local} />
          {substances && (
            <Link href="/sustancias" className="hover:bg-muted/60 focus-visible:ring-ring -mx-2 mt-3 flex min-h-11 items-center rounded-xl px-2 text-[14px] font-medium outline-none focus-visible:ring-2">
              Abrir Sustancias
              <ChevronRight className="text-muted-foreground ml-auto size-4" />
            </Link>
          )}
        </Card>
        <Card delay={240}>
          <CardTitle icon={Palette} color="var(--pulso-rose)" title="Apariencia" />
          <AppearancePanel />
        </Card>
      </div>
    </Page>
  );
}
