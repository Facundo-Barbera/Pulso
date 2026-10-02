"use client";

import type { BodyImport, BodyScanInput, InBodyParse } from "@pulso/contract";
import { Check, FileSpreadsheet, ImageUp, QrCode, SquarePen, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../_ui/cn";
import { inputClass, kg, primaryButton, problem, quietButton } from "./metrics";

type Tab = "csv" | "qr" | "manual";

const TABS: { key: Tab; label: string; icon: typeof QrCode }[] = [
  { key: "csv", label: "CSV", icon: FileSpreadsheet },
  { key: "qr", label: "QR", icon: QrCode },
  { key: "manual", label: "A mano", icon: SquarePen },
];

/** The three ways in on the desktop: the InBody CSV export, the QR (its text, or an image of it), or typing the numbers. */
export function AddScan({ initial = "csv" }: { initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <div>
      <div role="tablist" aria-label="Cómo añadir" className="bg-muted flex rounded-xl p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn("focus-visible:ring-ring flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium outline-none focus-visible:ring-2", tab === key ? "bg-card shadow-1" : "text-muted-foreground hover:text-foreground")}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">{tab === "csv" ? <CsvImport /> : tab === "qr" ? <QrImport /> : <ManualEntry />}</div>
    </div>
  );
}

function Done({ text }: { text: string }) {
  return (
    <p className="text-good mt-3 flex items-center gap-1.5 text-[13px] font-medium" aria-live="polite">
      <Check className="size-4" /> {text}
    </p>
  );
}

const Failure = ({ text }: { text: string }) => (
  <p className="text-destructive mt-3 text-[13px] leading-relaxed" role="alert">
    {text}
  </p>
);

function CsvImport() {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BodyImport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await fetch("/api/web/cuerpo/import", { method: "POST", headers: { "content-type": "text/csv" }, body: await file.text() });
    setBusy(false);
    if (!response.ok) return setError(await problem(response));
    setResult((await response.json()) as BodyImport);
    router.refresh();
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(e.dataTransfer.files[0]);
        }}
        className={cn(
          "focus-within:ring-ring flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition-colors focus-within:ring-2",
          over ? "border-primary bg-primary/8" : "border-border hover:bg-muted/50",
        )}
      >
        <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ""))} />
        <Upload className="text-muted-foreground size-6" />
        <span className="text-[14px] font-medium">{busy ? "Importando…" : "Suelta aquí el CSV o elige el archivo"}</span>
        <span className="text-muted-foreground max-w-xs text-[12px] leading-relaxed">La exportación de la app InBody o de LookinBody. Importar el mismo archivo dos veces no duplica nada.</span>
      </label>
      {result && (
        <>
          <Done text={`${result.imported === 1 ? "1 medición importada" : `${result.imported} mediciones importadas`}.`} />
          {result.skipped.length > 0 && (
            <details className="text-muted-foreground mt-1 text-[12px]">
              <summary className="cursor-pointer">{result.skipped.length === 1 ? "1 fila ignorada" : `${result.skipped.length} filas ignoradas`}</summary>
              <ul className="mt-1 space-y-0.5">
                {result.skipped.map((s) => (
                  <li key={s.line}>
                    Línea {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {error && <Failure text={error} />}
    </div>
  );
}

/** Chromium's barcode reader (Electron, Chrome). Safari and Firefox lack it: there the person pastes the QR's text. */
type Detector = { detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => Detector;
  }
}

/** The values a parsed QR shows before saving, in the hero's order. */
const PREVIEW: { key: keyof BodyScanInput; label: string; unit: string }[] = [
  { key: "weight", label: "Peso", unit: "kg" },
  { key: "percentBodyFat", label: "Grasa", unit: "%" },
  { key: "skeletalMuscleMass", label: "Músculo", unit: "kg" },
  { key: "bodyFatMass", label: "Masa grasa", unit: "kg" },
];

function QrImport() {
  const router = useRouter();
  const [payload, setPayload] = useState("");
  const [scan, setScan] = useState<BodyScanInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => setCanRead(typeof window.BarcodeDetector === "function"), []);

  async function parse(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    setScan(null);
    const response = await fetch("/api/web/cuerpo/inbody", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: text }) });
    setBusy(false);
    const result = (await response.json().catch(() => null)) as InBodyParse | { message: string } | null;
    if (result && "ok" in result && result.ok) setScan(result.scan);
    else setError(result?.message ?? `Algo falló (${response.status}).`);
  }

  async function readImage(image: File | undefined) {
    if (!image || !window.BarcodeDetector) return;
    setError(null);
    try {
      const [code] = await new window.BarcodeDetector({ formats: ["qr_code"] }).detect(await createImageBitmap(image));
      if (!code) return setError("No encontré un QR en esa imagen. Prueba con un recorte más cercano.");
      setPayload(code.rawValue);
      await parse(code.rawValue);
    } catch {
      setError("No pude leer esa imagen.");
    }
  }

  async function save() {
    if (!scan) return;
    setBusy(true);
    const response = await fetch("/api/web/cuerpo/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scan) });
    setBusy(false);
    if (!response.ok) return setError(await problem(response));
    setSaved(true);
    setScan(null);
    setPayload("");
    router.refresh();
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          parse(payload);
        }}
      >
        <label htmlFor="qr-payload" className="text-muted-foreground text-[12px] font-medium">
          Texto del QR
        </label>
        <textarea
          id="qr-payload"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          onPaste={(e) => {
            const image = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (image && canRead) {
              e.preventDefault();
              readImage(image);
            }
          }}
          rows={3}
          spellCheck={false}
          placeholder="https://qrcode.inbody.com?IBData=…"
          className={cn(inputClass, "mt-1 resize-none py-2.5 font-mono text-[12px] break-all")}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" disabled={!payload.trim() || busy} className={primaryButton}>
            {busy && !scan ? "Leyendo…" : "Leer"}
          </button>
          {canRead && (
            <>
              <button type="button" onClick={() => file.current?.click()} className={quietButton}>
                <ImageUp className="size-4" /> Desde una imagen
              </button>
              <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => (readImage(e.target.files?.[0]), (e.target.value = ""))} />
            </>
          )}
        </div>
        <p className="text-muted-foreground mt-2 text-[12px] leading-relaxed">
          {canRead ? "Pega el texto del QR, o una captura de él (⌘V aquí), o elige la imagen." : "Pega el texto que da cualquier lector de QR. Este navegador no lee QR desde imágenes; la ventana de Pulso en la Mac sí."}
        </p>
      </form>

      {scan && (
        <div className="bg-muted/60 mt-4 rounded-2xl p-4">
          <p className="text-[13px] font-medium">
            {scan.device ? `InBody ${scan.device}` : "InBody"} · {new Date(scan.measuredAt).toLocaleString("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {PREVIEW.map((p) => (
              <div key={p.key}>
                <dt className="text-muted-foreground text-[12px]">{p.label}</dt>
                <dd className="tabular text-[17px] font-semibold">
                  {scan[p.key] != null ? kg(scan[p.key] as number) : "—"} <span className="text-muted-foreground text-[12px] font-normal">{p.unit}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={busy} className={primaryButton}>
              Guardar medición
            </button>
            <button onClick={() => setScan(null)} className={quietButton}>
              Descartar
            </button>
          </div>
        </div>
      )}
      {saved && <Done text="Medición guardada." />}
      {error && <Failure text={error} />}
    </div>
  );
}

/** `YYYY-MM-DDTHH:mm` in this browser's local time, for `datetime-local`. */
const localInput = (at: Date) => new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const number = (text: string) => (text.trim() ? Number(text.replace(",", ".")) : null);

const FIELDS = [
  { key: "weight", label: "Peso", unit: "kg" },
  { key: "skeletalMuscleMass", label: "Músculo esquelético", unit: "kg" },
  { key: "bodyFatMass", label: "Masa grasa", unit: "kg" },
  { key: "percentBodyFat", label: "Grasa", unit: "%" },
] as const;

function ManualEntry() {
  const router = useRouter();
  const [when, setWhen] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Set after mount: the server's clock and timezone must not leak into the form.
  useEffect(() => setWhen(localInput(new Date())), []);

  const parsed = Object.fromEntries(FIELDS.map((f) => [f.key, number(values[f.key] ?? "")]));
  const invalid = Object.values(parsed).some((v) => v !== null && !(Number.isFinite(v) && v > 0));
  const enough = parsed.weight != null || [parsed.skeletalMuscleMass, parsed.bodyFatMass, parsed.percentBodyFat].filter((v) => v != null).length >= 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const response = await fetch("/api/web/cuerpo/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "manual", measuredAt: when ? new Date(when).getTime() : Date.now(), ...parsed }),
    });
    setBusy(false);
    if (!response.ok) return setError(await problem(response));
    setSaved(true);
    setValues({});
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className="text-muted-foreground text-[12px] font-medium">Fecha y hora</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={cn(inputClass, "mt-1")} />
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className="block min-w-0">
            <span className="text-muted-foreground text-[12px] font-medium">
              {f.label} <span className="font-normal">({f.unit})</span>
            </span>
            <input inputMode="decimal" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder="—" className={cn(inputClass, "mt-1")} />
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || invalid || !enough} className={primaryButton}>
          {busy ? "Guardando…" : "Guardar medición"}
        </button>
        <p className="text-muted-foreground text-[12px]">{invalid ? "Revisa los números: sólo valores positivos." : "El peso basta; sin él, dos de los otros tres."}</p>
      </div>
      {saved && <Done text="Medición guardada." />}
      {error && <Failure text={error} />}
    </form>
  );
}
