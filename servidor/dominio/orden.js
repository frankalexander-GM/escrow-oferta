/**
 * Capa de dominio: reglas puras, sin HTTP ni blockchain.
 * Aquí viven los estados del negocio y la traducción de datos → vista.
 */
const { ethers } = require("ethers");
const { ErrorAplicacion } = require("./errores");

const ROLES = ["arbitro", "comprador", "vendedor"];

const ESTADOS = ["Inexistente", "Creado", "Financiado", "Liberado", "Reembolsado", "EnDisputa"];

function esBytes32(valor) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(valor || "").trim());
}

/**
 * Un id de oferta llega como texto ("oferta-001") y en la cadena tiene que ser
 * bytes32. Si ya viene en ese formato, se respeta.
 */
function aBytes32(valor) {
  const texto = String(valor || "").trim();
  if (!texto) throw new ErrorAplicacion("Falta el id de la orden");
  if (esBytes32(texto)) return texto;
  return ethers.keccak256(ethers.toUtf8Bytes(texto));
}

/** Convierte la struct que devuelve el contrato en algo legible por HTTP. */
function normalizarOrden(id, orden) {
  return {
    id,
    comprador: orden.comprador,
    vendedor: orden.vendedor,
    montoEther: ethers.formatEther(orden.monto),
    plazoEntrega: new Date(Number(orden.plazoEntrega) * 1000).toISOString(),
    estado: ESTADOS[Number(orden.estado)] || "Desconocido",
  };
}

/** Resuelve "vendedor" o una dirección 0x… a una cuenta conocida. */
function aDireccion(valor, direcciones) {
  const texto = String(valor || "").trim();
  if (ROLES.includes(texto)) {
    if (!direcciones[texto]) {
      throw new ErrorAplicacion(`La cuenta "${texto}" no está configurada`, 503);
    }
    return direcciones[texto];
  }
  if (!ethers.isAddress(texto)) {
    throw new ErrorAplicacion(`Dirección inválida: ${texto}`);
  }
  return ethers.getAddress(texto);
}

module.exports = { ROLES, ESTADOS, aBytes32, normalizarOrden, aDireccion };
