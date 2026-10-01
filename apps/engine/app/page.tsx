import { listDevices } from "@/src/devices";
import { listWorkouts } from "@/src/workouts";
import { PairPhone } from "./pair-phone";

export const dynamic = "force-dynamic";

const fmtDate = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });

export default function Home() {
  const workouts = listWorkouts();
  const devices = listDevices();
  return (
    // pt-12 leaves room for macOS's traffic lights under the hidden title bar.
    <main className="mx-auto max-w-3xl space-y-10 px-6 pt-12 pb-10">
      <header>
        <h1 className="text-2xl font-semibold">Pulso</h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Entrenamientos</h2>
        {workouts.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía nada. Empareja el iPhone y sincroniza desde Salud.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {workouts.map((w) => (
              <li key={w.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-medium">{w.activity}</span>
                <span className="text-neutral-500">
                  {fmtDate.format(w.startedAt)} · {Math.round((w.endedAt - w.startedAt) / 60_000)} min
                  {w.energy != null && ` · ${Math.round(w.energy)} kcal`}
                  {w.distance != null && ` · ${(w.distance / 1000).toFixed(2)} km`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">iPhone</h2>
        {devices.length > 0 && (
          <ul className="text-sm">
            {devices.map((d) => (
              <li key={d.id}>
                {d.name} — emparejado {fmtDate.format(d.pairedAt)}
                {d.lastSeenAt && `, visto ${fmtDate.format(d.lastSeenAt)}`}
              </li>
            ))}
          </ul>
        )}
        <PairPhone />
      </section>
    </main>
  );
}
