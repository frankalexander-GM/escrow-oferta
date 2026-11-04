# EscrowOferta — contrato inteligente funcional + API desplegable

Contrato de **escrow** (dinero en garantía) en Solidity 0.8.24 para una app de
ofertas: el comprador paga, el dinero queda retenido y solo se libera cuando
confirma la entrega, cuando vence el plazo o cuando un árbitro resuelve una
disputa.

Incluye contrato, tests, API REST, panel web y despliegue con Docker pensado para
Coolify.

```
Compiled 1 Solidity file successfully (evm target: paris)
25 passing (1s)                    # tests del contrato
8 passing                          # tests de la capa de servicios (sin cadena)
18 comprobaciones OK               # prueba de humo HTTP
```

## El flujo en una imagen

```
comprador                     contrato                     vendedor
    |                             |                             |
    |-- crearOrden(id, vendedor) ->|                             |
    |                             |                             |
    |-- financiar(id) + 1 ETH --->|  (dinero en custodia)       |
    |                             |                             |
    |   [a] confirmarEntrega  --->|--- 96,5 % ------------------>|  saldoPendiente
    |                             |--- 3,5 % -> árbitro         |
    |                             |                             |
    |   [b] reclamarVencimiento ->|--- 100 % ------------------>|  (al comprador)
    |                             |                             |
    |   [c] abrirDisputa -------->|  congelado                  |
    |                             |<-- resolverDisputa -------- (árbitro)
```

## Qué hace exactamente

| Función                           | Quién                | Cuándo                       |
| --------------------------------- | -------------------- | ---------------------------- |
| `crearOrden(id, vendedor, plazo)` | comprador            | al aceptar la oferta         |
| `financiar(id)` payable           | comprador            | al pagar                     |
| `confirmarEntrega(id)`            | comprador            | al recibir el producto       |
| `reclamarVencimiento(id)`         | cualquiera           | si pasa el plazo sin entrega |
| `cancelar(id)`                    | vendedor             | devolución voluntaria        |
| `abrirDisputa(id)`                | comprador o vendedor | conflicto                    |
| `resolverDisputa(id, bool)`       | árbitro              | decide todo a una parte      |
| `pausar()` / `reanudar()`         | árbitro              | parada de emergencia         |
| `retirar()`                       | cualquiera con saldo | cobra lo acumulado           |

## Decisiones de diseño que importan

1. **Patrón pull, no push.** El contrato nunca envía ETH mientras cambia estado:
   acredita `saldoPendiente` y el beneficiario retira. Así una dirección que
   revierte la recepción no puede bloquear una orden.
2. **Efectos antes que interacciones + `nonReentrant`.** En `retirar()` el saldo
   se pone a cero antes del `call`, y hay cerrojo de reentrada.
3. **Contabilidad verificable.** `totalEnCustodia` y `saldoPendiente` permiten
   comprobar que `balance(contrato) == custodia + pendientes`. El test
   `contabilidad` lo verifica tras operaciones mezcladas.
4. **Errores personalizados** (`error NoAutorizado()`), no strings: más barato y
   tipado.
5. **Comisión acotada en el constructor** (máx. 10 %). Si el despliegue se
   equivoca, revierte en vez de cobrar de más para siempre.
6. **`receive()` y `fallback()` revierten**: el contrato solo acepta dinero por
   `financiar()`. Evita fondos huérfanos sin orden asociada.
7. **`uint128` para el importe** permite empaquetar la struct y ahorrar gas, con
   comprobación explícita al financiar.

## Arquitectura por capas

Cada capa solo conoce a la de al lado, y siempre en un sentido:

```
  rutas/        presentación HTTP     req/res, códigos de estado
      ↓
  servicios/    casos de uso          crear, financiar, confirmar…
      ↓
  infra/        acceso a la cadena    ethers, nonces, despliegue
      ↓
  dominio/      reglas puras          estados, errores, formato
```

| Capa            | Archivo                                                       | Responsabilidad                                    | Si cambia…                             |
| --------------- | ------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------- |
| Dominio         | `dominio/orden.js`, `dominio/errores.js`, `dominio/dinero.js` | estados, validación, importes, traducción de datos | las reglas del negocio                 |
| Infraestructura | `infra/cadena.js`, `infra/escrowRepositorio.js`               | provider, wallets, llamadas al contrato            | cambias ethers por viem o ETH por USDC |
| Aplicación      | `servicios/escrowServicio.js`                                 | orquesta los casos de uso                          | añades una operación nueva             |
| Presentación    | `rutas/api.js`, `publico/index.html`                          | HTTP y panel                                       | rediseñas la interfaz                  |
| Composición     | `index.js`, `config.js`                                       | une todo y arranca                                 | nada                                   |

El contrato en sí (`EscrowOferta.sol`) es un archivo único **por naturaleza**: en
Solidity el contrato es la unidad de despliegue, no se reparte en módulos sin
perder la dirección. Lo que sí está separado es todo lo de fuera.

## Estructura

```
escrow-oferta/
├── contracts/EscrowOferta.sol        el contrato
├── test/EscrowOferta.test.js         25 tests del contrato
├── test/servicio.test.js             8 tests de la capa de servicios
├── scripts/desplegar.js              despliegue por CLI
├── scripts/exportar-abi.js           ABI → servidor/abi tras compilar
├── servidor/
│   ├── index.js                      composición y arranque
│   ├── config.js                     entorno y claves
│   ├── dominio/orden.js              estados, ids, formato
│   ├── dominio/dinero.js              importes: texto ↔ wei
│   ├── dominio/errores.js            ErrorAplicacion y mapeo HTTP
│   ├── infra/cadena.js               provider, wallets, despliegue
│   ├── infra/escrowRepositorio.js    única puerta al contrato
│   ├── servicios/escrowServicio.js   casos de uso
│   ├── rutas/api.js                  endpoints
│   ├── publico/index.html            panel web
│   ├── abi/EscrowOferta.json         ABI + bytecode
│   └── prueba-humo.js                prueba end-to-end por HTTP
├── Dockerfile
├── docker-compose.yml                api + cadena local
└── COOLIFY.md                        guía de despliegue paso a paso
```

## Auditoría de seguridad (skill `solidity-security`)

El contrato se revisó contra el checklist de 15 puntos de la skill
`wshobson/agents@solidity-security`. Resultado:

| Punto del checklist               | Estado                                               |
| --------------------------------- | ---------------------------------------------------- |
| Reentrancy (CEI + guard)          | ✅ `retirar()` pone el saldo a cero antes del `call` |
| Overflow / underflow              | ✅ Solidity 0.8.24 revierte solo                     |
| Control de acceso                 | ✅ `arbitro` inmutable y comprobación por rol        |
| Pull over push                    | ✅ saldos acreditados; cada uno retira lo suyo       |
| Llamadas externas al final        | ✅ una sola, en `retirar()`                          |
| Retorno de llamadas comprobado    | ✅ `TransferenciaFallida`                            |
| Sin `tx.origin` ni `delegatecall` | ✅                                                   |
| Sin direcciones hardcodeadas      | ✅ constructor                                       |
| Evento en cada cambio de estado   | ✅                                                   |
| **Invariante contable**           | ⚠️ era `balance >= custodia` → corregido             |
| **Parada de emergencia**          | ❌ no existía → añadida                              |
| **Financiar orden vencida**       | ❌ se permitía → ahora `PlazoVencido`                |
| **Id cero**                       | ❌ se aceptaba → ahora `IdInvalido`                  |
| Front-running (commit-reveal)     | ➖ no aplica: no hay swaps ni precios                |
| Upgrade (proxy)                   | ➖ no aplica: el contrato es inmutable por diseño    |

### Los cuatro arreglos

1. **`totalPendiente`**: nuevo acumulador. `contabilidadCuadra()` exige ahora
   `balance == custodia + pendiente`, exacto en vez de una cota inferior. Sin
   esto, un descuadre de hasta el saldo pendiente pasaba desapercibido.
2. **`pausar()` / `reanudar()`**: circuit breaker del árbitro que bloquea
   `crearOrden` y `financiar`. **Nunca** bloquea `retirar`, `confirmarEntrega`,
   `reclamarVencimiento` ni `resolverDisputa`: una pausa no puede atrapar dinero.
3. **`PlazoVencido`**: no se puede depositar en una orden cuyo plazo ya pasó.
4. **`IdInvalido`**: `bytes32(0)` deja de ser un identificador válido.

Cada arreglo tiene su test en el bloque `seguridad (checklist solidity-security)`
de `test/EscrowOferta.test.js`, y la pausa se prueba también de punta a punta por
HTTP.

## Calidad de código

Todo el proyecto pasa las mismas comprobaciones antes de entregarse:

```powershell
npm run verificar     # eslint + solhint + prettier + 28 tests
```

| Comando            | Qué revisa                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `npm run lint`     | ESLint 9 (flat config): variables muertas, `==` flojo, `var`, sombras, coerciones implícitas |
| `npm run lint:sol` | Solhint sobre el contrato: visibilidad, orden de funciones, natspec                          |
| `npm run formato`  | Prettier + plugin de Solidity, ancho 100 columnas                                            |
| `npm test`         | 25 tests del contrato + 8 de la capa de servicios                                            |

Decisiones que conviene saber explicar:

- **Prettier manda en el formato.** Ninguna discusión de estilo en el código:
  se ejecuta y ya. Por eso el turno de revisión no discute espacios.
- **Regla `immutable-vars-naming` desactivada en Solhint.** Exigiría
  `ARBITRO`/`COMISION_BPS`, y esos nombres son los getters públicos del ABI: cambiarlos
  rompe a los consumidores. Es una excepción consciente, no un descuido.
- **El ABI no se copia a mano.** `npm run compilar` compila y ejecuta
  `scripts/exportar-abi.js`, que regenera `servidor/abi/EscrowOferta.json`. Si no
  existiera ese paso, el servidor podría usar un ABI viejo sin avisar.
- **Los servicios no importan `ethers`.** La prueba `test/servicio.test.js` los
  ejecuta contra un repositorio falso: si alguien mete una dependencia de la
  cadena en esa capa, el test deja de compilar sin necesidad de red.

### Refactor de limpieza (skill `clean-code`)

Aplicado sobre el código que ya funcionaba, sin cambiar comportamiento:

| Antes                                         | Después                                                             |
| --------------------------------------------- | ------------------------------------------------------------------- |
| 4 respuestas `{ ok, tx, orden }` copiadas     | un `respuestaDeOrden()`                                             |
| `estado()` con 20 líneas y 8 awaits mezclados | `estado()` + `saldosPorRol()` + `cuentasConfiguradas()`             |
| `3600`, `24`, `"1"` sueltos en el código      | `SEGUNDOS_POR_HORA`, `PLAZO_POR_DEFECTO_HORAS`, `MONTO_POR_DEFECTO` |
| `main()` de la prueba de humo con 80 líneas   | 12 líneas que orquestan 5 funciones con nombre                      |
| `ordenDe()`                                   | `ordenNormalizada()` (dice qué devuelve)                            |

En los tests **no** se eliminó duplicación a propósito: un test explícito se lee
mejor que uno parametrizado, y esa repetición es deliberada, no un descuido.

## Cómo ejecutarlo en local

```powershell
git clone https://github.com/frankalexander-GM/escrow-oferta.git
cd escrow-oferta
npm install
npx hardhat test                     # 28 tests (20 contrato + 8 servicios)
npx hardhat node                     # nodo local con cuentas de prueba
npx hardhat run scripts/desplegar.js --network localhost
```

## Probarlo end-to-end (API + panel, sin Docker)

```powershell
node servidor/prueba-humo.js
```

Levanta un nodo Hardhat, arranca la API (que despliega el contrato sola) y recorre
el flujo completo por HTTP: crear, financiar, confirmar, retirar, y comprobar que
un segundo intento de confirmar falla con `EstadoInvalido`. 18 comprobaciones.

Para ver el panel:

```powershell
node servidor/index.js               # con un nodo en 8545
# abre http://127.0.0.1:3000
```

## API

| Método | Ruta                         | Qué hace                               |
| ------ | ---------------------------- | -------------------------------------- |
| GET    | `/salud`                     | estado y dirección del contrato        |
| GET    | `/api/estado`                | custodia, saldos por rol, contabilidad |
| POST   | `/api/ordenes`               | `{ id, vendedor, plazoHoras }`         |
| POST   | `/api/ordenes/:id/financiar` | `{ montoEther }`                       |
| POST   | `/api/ordenes/:id/confirmar` | libera el pago                         |
| POST   | `/api/ordenes/:id/cancelar`  | devuelve el dinero (vendedor)          |
| POST   | `/api/ordenes/:id/reclamar`  | reclama por vencimiento                |
| POST   | `/api/ordenes/:id/disputa`   | congela la orden                       |
| POST   | `/api/ordenes/:id/resolver`  | `{ aFavorDelVendedor }`                |
| POST   | `/api/retirar`               | `{ rol }`                              |
| POST   | `/api/pausar`                | corta la entrada de dinero             |
| POST   | `/api/reanudar`              | vuelve a la normalidad                 |
| GET    | `/api/ordenes/:id`           | estado de una orden                    |

Los errores del contrato llegan con su nombre (`EstadoInvalido`,
`NoAutorizado`, `AunNoVencida`) porque la API simula la llamada antes de enviarla.

## Desplegarlo en el servidor

Guía completa: **[COOLIFY.md](COOLIFY.md)**

Resumen: `docker compose up -d --build` levanta dos contenedores — un nodo
blockchain local y la API/panel en el puerto 3000. En Coolify se importa el repo
como Docker Compose con _Base Directory_ `/`.

## Cómo se conecta con la app Flutter

1. **Backend propio (recomendado)**: el móvil nunca firma. El backend custodia la
   clave del árbitro y expone `POST /api/ordenes/{id}/confirmar`. El usuario paga
   con su medio habitual y el backend llama al contrato.
2. **Wallet directa**: el usuario firma con WalletConnect. Requiere que tenga ETH
   y entienda el gas. Solo tiene sentido si el público ya es cripto.
3. **Lectura pública**: aunque el flujo sea custodio, cualquiera puede leer
   `verOrden(id)` y verificar que el dinero existe. Ese es el valor real: la
   garantía es auditable, no una promesa.

## Lo que este contrato NO resuelve

- **El problema del oráculo.** Alguien decide si la entrega ocurrió. Aquí es el
  comprador (o el árbitro en disputa). Sin firma de mensajería, sigue siendo
  confianza humana.
- **Custodia de la clave del árbitro.** Si se compromete, puede resolver disputas
  a su favor. En producción: multisig 2-de-3 y timelock.
- **Estabilidad del precio.** Con ETH nativo, entre financiar y liberar el valor
  baila. Para negocio real, migrar a una stablecoin (USDC).
- **Legalidad.** Mover dinero de terceros puede convertirte en entidad de pago.
  Este contrato no sustituye licencias ni KYC/AML.
- **Auditoría.** Los tests no son una auditoría.

## Siguientes pasos naturales

1. Cambiar ETH por `IERC20` (USDC).
2. Añadir EIP-712 para que la confirmación venga firmada por el mensajero.
3. Extender `resolverDisputa` a reparto parcial (`uint16 bpsAlVendedor`).
4. `EscrowFactory` si se quiere una instancia por orden con historial aislado.
