/**
 * Punto de composición: aquí se juntan las capas y arranca el servidor.
 * Es el único archivo que conoce a todas las demás.
 *
 *   rutas (HTTP)  →  servicios (casos de uso)  →  repositorio (contrato)
 *                            ↓
 *                     dominio (reglas puras)
 */
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const config = require("./config");

const RUTA_ABI = path.join(__dirname, "abi", "EscrowOferta.json");

if (!fs.existsSync(RUTA_ABI)) {
  console.error("[fatal] Falta servidor/abi/EscrowOferta.json. Ejecuta antes: npm run compilar");
  process.exit(1);
}

const artefacto = require(RUTA_ABI);
const { conectar } = require("./infra/cadena");
const { crearRepositorio } = require("./infra/escrowRepositorio");
const { crearServicio } = require("./servicios/escrowServicio");
const { crearRouter } = require("./rutas/api");
const { mensajeDeError } = require("./dominio/errores");

async function iniciar() {
  const ctx = await conectar(config, artefacto);
  const repositorio = crearRepositorio(ctx);
  const servicio = crearServicio({ ctx, repositorio });

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "publico")));

  // CORS abierto: el panel puede servirse desde otro dominio.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/salud", (req, res) => res.json(servicio.salud()));
  app.use("/api", crearRouter(servicio));

  return new Promise((resolve) => {
    const servidor = app.listen(config.puerto, "0.0.0.0", () => {
      console.log(`[api] Escuchando en http://0.0.0.0:${config.puerto}`);
      resolve(servidor);
    });
  });
}

if (require.main === module) {
  iniciar().catch((error) => {
    console.error("[fatal]", mensajeDeError(error));
    process.exit(1);
  });
}

module.exports = { iniciar };
