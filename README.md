# Pulso

App personal de fitness. Monorepo con Turborepo y Bun, con la misma forma que Delta: un engine local que guarda los datos, una ventana de Electron que apunta a él y un iPhone que llega por Tailscale.

| | Qué es |
|---|---|
| `apps/engine` | Next.js (bajo Bun) en `127.0.0.1:3230`. Sirve la ventana, la API del iPhone (`/api/mobile/*`) y guarda todo en SQLite (`~/Library/Application Support/Pulso/engine/pulso.sqlite`, `bun:sqlite`; `PULSO_HOME` o `PULSO_DATA_DIR` lo mueven) |
| `apps/desktop` | Electron. No contiene servidor: `dev-runner.js` arranca el engine, espera `/api/health` y abre la ventana |
| `apps/ios` | SwiftUI + HealthKit (XcodeGen). Se empareja con un código de 8 dígitos y sincroniza entrenamientos de Salud |
| `packages/contract` | Tipos y constantes compartidos entre el engine y sus clientes |

## Uso

```sh
bun install
bun run dev          # engine + ventana de escritorio
bun run dev:web      # sólo el engine (turbo), para mirarlo en un navegador
bun run tailnet      # expone el engine al tailnet en <ip-tailscale>:8090
bun run test         # turbo: tests del engine
bun run typecheck
bun run ios:generate # regenera Pulso.xcodeproj desde apps/ios/project.yml
bun run ios:phone    # compila e instala "Pulso Dev" en el iPhone
```

## Cómo llega el iPhone

1. `bun run tailnet` escucha **sólo** en la IP de Tailscale (nunca `0.0.0.0`) y reenvía a `127.0.0.1:3230` marcando cada pedido con `x-pulso-via: tailnet`.
2. `apps/engine/proxy.ts` deja pasar desde el tailnet únicamente `/api/mobile/*`. La ventana, la generación de códigos y lo demás quedan sólo para la Mac.
3. En la ventana: **Generar código**. En el iPhone: dirección + código. El código vale 5 minutos y un uso, y se cambia por un token bearer (en la DB sólo se guarda su hash; en el teléfono, en el Keychain).
4. **Sincronizar desde Salud** manda los entrenamientos de los últimos 30 días. El engine los deduplica por UUID de HealthKit.

Debug (`com.facundo.pulso.dev`) y Release (`com.facundo.pulso`) son apps distintas para iOS, cada una con su emparejamiento.
