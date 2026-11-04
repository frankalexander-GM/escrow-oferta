/**
 * Dinero: conversión entre lo que escribe el usuario ("1.5") y lo que entiende
 * la cadena (wei, entero). Nunca se usan decimales flotantes para importes.
 */
const { ethers } = require("ethers");
const { ErrorAplicacion } = require("./errores");

function aWei(texto) {
  const limpio = String(texto ?? "").trim();
  if (!limpio) throw new ErrorAplicacion("Falta el importe");

  let valor;
  try {
    valor = ethers.parseEther(limpio);
  } catch {
    throw new ErrorAplicacion(`Importe inválido: ${limpio}`);
  }

  if (valor <= 0n) throw new ErrorAplicacion("El importe debe ser mayor que 0");
  return valor;
}

function aEther(wei) {
  return ethers.formatEther(wei);
}

module.exports = { aWei, aEther };
