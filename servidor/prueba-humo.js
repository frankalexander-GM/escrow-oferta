/**
 * Prueba de humo de punta a punta:
 *   1. levanta un nodo Hardhat
 *   2. levanta la API (que despliega el contrato sola)
 *   3. recorre el flujo completo por HTTP
 *   4. comprueba el resultado contra el estado del contrato
 *
 * Uso:  node servidor/prueba-humo.js
 */
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const RPC = "http://127.0.0.1:8545";
const PUERTO = "3100";
const BASE = `http://127.0.0.1:${PUERTO}`;

const hijos = [];
let fallos = 0;

function arrancar(comando, args, env = {}) {
  const hijo = spawn(comando, args, {
    cwd: RAIZ,
    shell: true,
    stdio: process.env.VERBOSE ? "inherit" : "ignore",
    env: { ...process.env, ...env },
  });
  hijos.push(hijo);
  return hijo;
}

async function esperarJsonRpc() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch {
      // El nodo aún no escucha: reintentamos.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("El nodo Hardhat no arrancó");
}

async function esperarApi() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/salud`);
      if (r.ok) return;
    } catch {
      // La API aún no responde: reintentamos.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("La API no arrancó");
}

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { "content-type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json();
  return { status: r.status, datos };
}

function comprobar(nombre, condicion, detalle = "") {
  if (condicion) {
    console.log(`  ok   ${nombre}`);
  } else {
    fallos++;
    console.log(`  FALLO ${nombre} ${detalle}`);
  }
}

async function main() {
  console.log("• Levantando cadena local…");
  arrancar("npx", ["hardhat", "node", "--hostname", "127.0.0.1"]);
  await esperarJsonRpc();

  console.log("• Levantando API (despliega el contrato al arrancar)…");
  arrancar(process.execPath, ["servidor/index.js"], {
    RPC_URL: RPC,
    PORT: PUERTO,
    COMISION_BPS: "350",
  });
  await esperarApi();

  console.log("\n• Flujo completo por HTTP\n");

  const salud = await api("GET", "/salud");
  comprobar("GET /salud responde", salud.status === 200 && salud.datos.ok);
  comprobar("contrato desplegado", /^0x[0-9a-fA-F]{40}$/.test(salud.datos.contrato || ""));

  const creada = await api("POST", "/api/ordenes", {
    id: "humo-1",
    vendedor: "vendedor",
    plazoHoras: 24,
  });
  comprobar("crear orden", creada.status === 200 && creada.datos.orden.estado === "Creado");

  const financiada = await api("POST", "/api/ordenes/humo-1/financiar", {
    montoEther: "0.5",
  });
  comprobar(
    "financiar 0,5 ETH",
    financiada.status === 200 &&
      financiada.datos.orden.estado === "Financiado" &&
      financiada.datos.orden.montoEther === "0.5"
  );

  const estado1 = await api("GET", "/api/estado");
  comprobar("custodia = 0,5 ETH", estado1.datos.custodiaEther === "0.5");
  comprobar("contabilidad cuadra", estado1.datos.contabilidadCuadra === true);

  const confirmada = await api("POST", "/api/ordenes/humo-1/confirmar");
  comprobar(
    "confirmar entrega",
    confirmada.status === 200 && confirmada.datos.orden.estado === "Liberado"
  );

  const estado2 = await api("GET", "/api/estado");
  comprobar("vendedor cobra 0,4825", estado2.datos.saldosPendientesEther.vendedor === "0.4825");
  comprobar("árbitro cobra 0,0175", estado2.datos.saldosPendientesEther.arbitro === "0.0175");
  comprobar("custodia a cero", estado2.datos.custodiaEther === "0.0");

  const retiroVendedor = await api("POST", "/api/retirar", { rol: "vendedor" });
  comprobar("retirar vendedor", retiroVendedor.status === 200);
  const retiroArbitro = await api("POST", "/api/retirar", { rol: "arbitro" });
  comprobar("retirar árbitro", retiroArbitro.status === 200);

  const final = await api("GET", "/api/estado");
  comprobar("contrato vacío", final.datos.balanceEther === "0.0");

  const repetida = await api("POST", "/api/ordenes/humo-1/confirmar");
  comprobar(
    "confirmar dos veces da 400",
    repetida.status === 400 && repetida.datos.error === "EstadoInvalido"
  );

  console.log(fallos === 0 ? "\nTODO OK\n" : `\n${fallos} fallo(s)\n`);
}

function limpiar() {
  for (const hijo of hijos) {
    if (!hijo.pid) continue;
    try {
      if (process.platform === "win32") {
        // spawnSync: en el handler de salida no podemos esperar promesas.
        spawnSync("taskkill", ["/PID", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        hijo.kill("SIGTERM");
      }
    } catch {
      // El proceso ya murió: no hay nada que limpiar.
    }
  }
}

process.on("exit", limpiar);
process.on("SIGINT", () => process.exit(1));

main()
  .then(() => process.exit(fallos === 0 ? 0 : 1))
  .catch((error) => {
    console.error("Error en la prueba:", error.message);
    process.exit(1);
  });
