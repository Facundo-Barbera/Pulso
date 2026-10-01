import { Link2, MonitorSmartphone, Palette } from "lucide-react";
import { headers } from "next/headers";
import { callerOf } from "@/src/device-auth";
import { listDevices } from "@/src/devices";
import { fromTailnet } from "@/src/tailnet-gate";
import { Card, CardTitle } from "../../_ui/card";
import { Page, PageHeader } from "../../_ui/page-header";
import { AppearancePanel } from "./_components/appearance-panel";
import { DeviceList, ThisBrowser } from "./_components/devices";
import { PairPanel } from "./_components/pair-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ajustes" };

/**
 * Ajustes. Pairing and the device list are admin: they render, and their
 * routes answer, on the Mac only. A paired browser sees itself instead, and
 * can forget itself.
 */
export default async function Ajustes() {
  const head = await headers();
  const local = !fromTailnet(head);
  const me = local ? undefined : callerOf(head).device;
  return (
    <Page>
      <PageHeader title="Ajustes" subtitle={local ? "Empareja el iPhone y otros navegadores, y elige cómo se ve Pulso." : "Este navegador está emparejado con la Mac que guarda tus datos."} />
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
          <CardTitle icon={Palette} color="var(--pulso-rose)" title="Apariencia" />
          <AppearancePanel />
        </Card>
      </div>
    </Page>
  );
}
