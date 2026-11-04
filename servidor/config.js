/**
 * Configuración: única fuente de verdad del entorno.
 * No conoce Express ni el contrato.
 */
const { ROLES } = require("./dominio/orden");

/**
 * Claves de las cuentas públicas de Hardhat. Sirven SOLO para la cadena de
 * demo local: son públicas y cualquiera las conoce. En una red real deben venir
 * por variable de entorno.
 */
const CLAVES_DEMO = {
  arbitro: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  comprador: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  vendedor: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
};

const config = {
  puerto: Number(process.env.PORT || 3000),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  comisionBps: Number(process.env.COMISION_BPS || 350),
  contratoDireccion: (process.env.CONTRATO_DIRECCION || "").trim(),
  claves: Object.fromEntries(
    ROLES.map((rol) => [
      rol,
      String(process.env[`CLAVE_${rol.toUpperCase()}`] || CLAVES_DEMO[rol] || "").trim(),
    ])
  ),
};

module.exports = config;
