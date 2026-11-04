/**
 * Capa de aplicación: casos de uso.
 *
 * Orquesta dominio + repositorio. No conoce HTTP (no hay req/res) ni ethers
 * (no hay contratos, firmantes ni wei): solo reglas de negocio.
 */
const { ErrorAplicacion } = require("../dominio/errores");
const { ROLES, aBytes32, normalizarOrden, aDireccion } = require("../dominio/orden");
const { aWei, aEther } = require("../dominio/dinero");

function crearServicio({ ctx, repositorio }) {
  const { direcciones } = ctx;

  async function ordenDe(clave) {
    return normalizarOrden(clave, await repositorio.verOrden(clave));
  }

  function salud() {
    return { ok: true, red: ctx.red, contrato: ctx.direccion };
  }

  async function estado() {
    const saldos = {};
    for (const rol of ROLES) {
      const cuenta = direcciones[rol];
      saldos[rol] = cuenta ? aEther(await repositorio.saldoPendiente(cuenta)) : null;
    }

    return {
      red: ctx.red,
      contrato: ctx.direccion,
      arbitro: await repositorio.arbitro(),
      comisionBps: Number(await repositorio.comisionBps()),
      custodiaEther: aEther(await repositorio.totalEnCustodia()),
      balanceEther: aEther(await repositorio.balanceContrato()),
      cuentas: Object.fromEntries(
        ROLES.filter((rol) => direcciones[rol]).map((rol) => [rol, direcciones[rol]])
      ),
      saldosPendientesEther: saldos,
      contabilidadCuadra: await repositorio.contabilidadCuadra(),
    };
  }

  async function crearOrden({ id, vendedor, plazoHoras = 24 } = {}) {
    const clave = aBytes32(id);
    const destino = aDireccion(vendedor || "vendedor", direcciones);

    const horas = Number(plazoHoras);
    if (!Number.isFinite(horas) || horas <= 0) {
      throw new ErrorAplicacion("plazoHoras debe ser un número mayor que 0");
    }

    const ahora = await repositorio.ultimoTimestamp();
    const plazo = ahora + Math.max(1, Math.round(horas)) * 3600;

    const recibo = await repositorio.crearOrden(clave, destino, plazo);
    return { ok: true, tx: recibo.hash, orden: await ordenDe(clave) };
  }

  async function financiar(id, { montoEther = "1" } = {}) {
    const clave = aBytes32(id);
    const recibo = await repositorio.financiar(clave, aWei(montoEther));
    return { ok: true, tx: recibo.hash, orden: await ordenDe(clave) };
  }

  const ACCIONES = {
    confirmar: (clave) => repositorio.confirmarEntrega(clave),
    cancelar: (clave) => repositorio.cancelar(clave),
    reclamar: (clave) => repositorio.reclamarVencimiento(clave),
    disputa: (clave) => repositorio.abrirDisputa(clave),
  };

  async function ejecutarAccion(nombre, id) {
    const ejecutar = ACCIONES[nombre];
    if (!ejecutar) throw new ErrorAplicacion(`Acción desconocida: ${nombre}`, 404);

    const clave = aBytes32(id);
    const recibo = await ejecutar(clave);
    return { ok: true, tx: recibo.hash, orden: await ordenDe(clave) };
  }

  async function resolver(id, { aFavorDelVendedor } = {}) {
    const clave = aBytes32(id);
    const recibo = await repositorio.resolverDisputa(clave, Boolean(aFavorDelVendedor));
    return { ok: true, tx: recibo.hash, orden: await ordenDe(clave) };
  }

  async function retirar({ rol } = {}) {
    if (!ROLES.includes(rol)) {
      throw new ErrorAplicacion("Rol inválido: usa arbitro, comprador o vendedor");
    }

    const antes = await repositorio.saldoPendiente(direcciones[rol]);
    if (antes === 0n) {
      throw new ErrorAplicacion(`La cuenta ${rol} no tiene saldo pendiente`);
    }

    const recibo = await repositorio.retirar(rol);
    return { ok: true, rol, tx: recibo.hash, retiradoEther: aEther(antes) };
  }

  async function consultarOrden(id) {
    const clave = aBytes32(id);
    return { ok: true, orden: await ordenDe(clave) };
  }

  return {
    salud,
    estado,
    crearOrden,
    financiar,
    ejecutarAccion,
    resolver,
    retirar,
    consultarOrden,
  };
}

module.exports = { crearServicio };
