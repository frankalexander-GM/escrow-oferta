/**
 * Repositorio: la única puerta de entrada al contrato.
 *
 * Expone operaciones con nombre de negocio (crearOrden, financiar, …), no
 * llamadas crudas al contrato. Los servicios no saben que existe ethers, ni
 * qué cuenta firma cada operación.
 */
const { ErrorAplicacion } = require("../dominio/errores");

function crearRepositorio(ctx) {
  const { contrato, provider, direccion, firmantes } = ctx;

  function firmante(rol) {
    const cuenta = firmantes[rol];
    if (!cuenta) {
      throw new ErrorAplicacion(
        `Falta la clave de "${rol}". Define CLAVE_${rol.toUpperCase()} en el entorno.`,
        503
      );
    }
    return cuenta;
  }

  /**
   * Simula antes de enviar: un revert llega con el nombre del error
   * personalizado (EstadoInvalido, NoAutorizado…) y no como
   * "unknown custom error".
   */
  async function ejecutar(rol, metodo, args = [], overrides = {}) {
    const contratoFirmado = contrato.connect(firmante(rol));
    await contratoFirmado[metodo].staticCall(...args, overrides);
    const transaccion = await contratoFirmado[metodo](...args, overrides);
    return transaccion.wait();
  }

  return {
    // ---------------------------------------------------------- consultas
    verOrden: (clave) => contrato.verOrden(clave),
    saldoPendiente: (cuenta) => contrato.saldoPendiente(cuenta),
    totalEnCustodia: () => contrato.totalEnCustodia(),
    balanceContrato: () => provider.getBalance(direccion),
    arbitro: () => contrato.arbitro(),
    comisionBps: () => contrato.comisionBps(),
    contabilidadCuadra: () => contrato.contabilidadCuadra(),
    pausado: () => contrato.pausado(),
    ultimoTimestamp: async () => (await provider.getBlock("latest")).timestamp,

    // ----------------------------------------------------------- comandos
    crearOrden: (clave, vendedor, plazo) =>
      ejecutar("comprador", "crearOrden", [clave, vendedor, plazo]),

    financiar: (clave, monto) => ejecutar("comprador", "financiar", [clave], { value: monto }),

    confirmarEntrega: (clave) => ejecutar("comprador", "confirmarEntrega", [clave]),

    cancelar: (clave) => ejecutar("vendedor", "cancelar", [clave]),

    reclamarVencimiento: (clave) => ejecutar("comprador", "reclamarVencimiento", [clave]),

    abrirDisputa: (clave) => ejecutar("comprador", "abrirDisputa", [clave]),

    resolverDisputa: (clave, aFavorDelVendedor) =>
      ejecutar("arbitro", "resolverDisputa", [clave, aFavorDelVendedor]),

    retirar: (rol) => ejecutar(rol, "retirar", []),

    pausar: () => ejecutar("arbitro", "pausar", []),

    reanudar: () => ejecutar("arbitro", "reanudar", []),
  };
}

module.exports = { crearRepositorio };
