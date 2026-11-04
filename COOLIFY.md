# Desplegarlo en el servidor con Coolify

## Primero, la idea que hay que tener clara

Un contrato inteligente **no se despliega en un servidor**: se despliega en una
blockchain. Lo que sí vive en el servidor es todo lo que lo rodea:

```
   VPS / Coolify
   ┌──────────────────────────────────────────────┐
   │  contenedor "api"     → panel web + API REST │  ← esto es lo que se abre
   │  contenedor "cadena"  → nodo blockchain       │  ← aquí vive el contrato
   └──────────────────────────────────────────────┘
                    │
                    │ (modo Sepolia, opcional)
                    └──────────► red pública de Ethereum
```

Traducido: el profe abre una URL en el navegador, hace clic en "Crear orden",
"Financiar" y "Confirmar", y ve cómo el dinero se mueve. Da igual si por debajo
hay una cadena local o Sepolia.

## Dos modos de despliegue

|                         | Modo A: cadena local (por defecto)                    | Modo B: Sepolia              |
| ----------------------- | ----------------------------------------------------- | ---------------------------- |
| Dónde está el contrato  | en el propio servidor, dentro del contenedor `cadena` | en la red pública de pruebas |
| Necesitas ETH de faucet | no                                                    | sí (gratis)                  |
| Persiste si reinicias   | no (se redespliega solo)                              | sí, dirección fija           |
| Sirve para clase        | sí, y es lo más cómodo                                | sí, y es más "real"          |

Empieza por el modo A. Es el que funciona en 5 minutos sin cuentas ni claves.

---

# Modo A — cadena local en el servidor

## 1. Sube el repo a GitHub

Coolify despliega desde un repositorio. Si el proyecto está en tu PC:

```powershell
cd contrato-inteligente
git init
git add .
git commit -m "Escrow + API + panel"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/escrow-oferta.git
git push -u origin main
```

`.dockerignore` ya excluye `node_modules`, `cache` y `test`, así que la imagen no
se llena de basura.

## 2. Crea el recurso en Coolify

1. **Project** → elige tu proyecto → **+ New Resource**.
2. **Private Repository (with GitHub App)** o **Public Repository**, según cómo
   hayas conectado el repo.
3. Rellena:
   - **Repository**: `TU_USUARIO/escrow-oferta`
   - **Branch**: `main`
   - **Build Pack**: `Docker Compose`
   - **Base Directory**: `/contrato-inteligente`
   - **Docker Compose Location**: `/docker-compose.yml`
4. **Save**.

## 3. Dominio

En el servicio `api` → pestaña **General** → **Domains**:

```
https://escrow.tudominio.com
```

Coolify crea el certificado TLS solo (Traefik + Let's Encrypt). Si no tienes
dominio, usa la URL temporal `http://IP_DEL_VPS:3000`.

> El puerto interno es **3000**. Si Coolify no lo detecta, en **Ports Mappings**
> pon `3000:3000` y en **Domains** añade `:3000` al final.

## 4. Despliega

Botón **Deploy**. La primera build tarda unos minutos (instala Hardhat, ~600
paquetes). Cuando termine:

- `https://tu-dominio/` → el panel con los botones
- `https://tu-dominio/salud` → `{"ok":true,"red":"unknown (31337)","contrato":"0x…"}`
- `https://tu-dominio/api/estado` → custodia, saldos y si la contabilidad cuadra

## 5. Qué pasa si reinicias

El nodo local no guarda estado en disco: al reiniciar, la API detecta que no hay
contrato en `CONTRATO_DIRECCION`, despliega uno nuevo y sigue. Para una demo es
justo lo que quieres (siempre limpio). Si necesitas persistencia, pasa al modo B.

---

# Modo B — contrato en Sepolia (permanente)

## 1. Consigue un RPC y ETH de prueba

- RPC gratis en Alchemy o Infura → te da una URL tipo
  `https://sepolia.infura.io/v3/xxxx`.
- ETH de prueba en cualquier faucet de Sepolia (busca "Sepolia faucet").

## 2. Despliega el contrato una vez

En tu PC, dentro de `contrato-inteligente`, añade la red a `hardhat.config.js`:

```js
networks: {
  sepolia: {
    url: process.env.RPC_URL,
    accounts: [process.env.PRIVATE_KEY],
  },
},
```

```powershell
$env:RPC_URL="https://sepolia.infura.io/v3/TU_CLAVE"
$env:PRIVATE_KEY="0xTU_CLAVE_PRIVADA"
npx hardhat run scripts/desplegar.js --network sepolia
```

Apunta la dirección que imprime.

## 3. Cambia el compose

En `docker-compose.yml`, dentro de `api.environment`:

```yaml
RPC_URL: https://sepolia.infura.io/v3/TU_CLAVE
CONTRATO_DIRECCION: "0xLA_DIRECCION_QUE_APUNTASTE"
CLAVE_ARBITRO: "0x…"
CLAVE_COMPRADOR: "0x…"
CLAVE_VENDEDOR: "0x…"
```

Y **borra el servicio `cadena`** y el bloque `depends_on`.

## 4. Claves: regla de oro

- En Coolify, márcalas como **secretas** (icono de ojo) para que no se muestren
  en los logs ni en la UI.
- Nunca las subas al repo. Si se filtran, cualquiera puede arbitrar disputas a
  su favor.
- Las claves de `CLAVES_DEMO` del código son públicas a propósito: solo valen
  para la cadena local. No las uses en Sepolia (no tienen fondos) ni en mainnet
  (sería un desastre).

---

# Alternativa sin Coolify (VPS pelado)

```bash
git clone https://github.com/TU_USUARIO/escrow-oferta.git
cd escrow-oferta/contrato-inteligente
docker compose up -d --build
docker compose logs -f api
```

Y delante, Nginx o Caddy apuntando a `127.0.0.1:3000`.

---

# Problemas típicos

| Síntoma                                  | Causa                                           | Solución                                                                        |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| El contenedor `api` reinicia en bucle    | no llega al RPC                                 | revisa logs: `docker compose logs api`                                          |
| `nonce has already been used`            | dos envíos con la misma cuenta sin NonceManager | ya está resuelto en el código; si lo ves, es que estás usando una versión vieja |
| Build se queda sin memoria (VPS de 1 GB) | `npm ci` con Hardhat pesa                       | añade 2 GB de swap, o construye la imagen en tu PC y súbela a un registry       |
| `502 Bad Gateway`                        | dominio apunta al puerto equivocado             | el servicio debe exponer 3000                                                   |
| CORS en el navegador                     | panel servido desde otro dominio                | ya está abierto con `Access-Control-Allow-Origin: *`                            |
| `execution reverted` sin detalle         | revert sin simulación previa                    | la API ya hace `staticCall` antes de enviar y devuelve el nombre del error      |

---

# Antes de enseñarlo: dos avisos

1. **El panel no tiene autenticación.** Cualquiera con la URL puede confirmar
   entregas y mover dinero. Para clase está bien; si queda público mucho tiempo,
   ponle Basic Auth en Coolify (Settings → Authentication) o un middleware.
2. **Esto es una demo, no un producto financiero.** Custodiar dinero de terceros
   requiere licencia, KYC/AML y auditoría. Explícalo tú antes de que lo pregunte
   el profe: suma puntos, no resta.

---

# Guion de 2 minutos para la demo

1. Abre el panel. Señala la dirección del contrato y "contabilidad cuadra: true".
2. **Crear orden** `oferta-001`, plazo 24 h → estado `Creado`.
3. **Financiar** 1 ETH → estado `Financiado`. El dinero ya no está en la cuenta
   de nadie: está en el contrato.
4. **Confirmar entrega** → `Liberado`. En estado del contrato: 0,965 al vendedor,
   0,035 al árbitro.
5. **Retirar** como vendedor → el saldo sale del contrato.
6. Repite **Confirmar entrega** → error `EstadoInvalido`. Eso demuestra que las
   reglas las impone el contrato, no la interfaz.
7. Cierra con: "podría haber puesto el contrato en Sepolia y la dirección sería
   verificable públicamente; el servidor solo es la puerta de entrada".
