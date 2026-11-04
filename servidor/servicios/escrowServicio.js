/**
 * Capa de aplicación: casos de uso.
 *
 * Orquesta dominio + repositorio. No conoce HTTP (no hay req/res) ni ethers
 * (no hay contratos, firmantes ni wei): solo reglas de negocio.
 */
const { ErrorAplicacion } = require("../dominio/errores");
const { ROLES, aBytes32, normalizarOrden, aDireccion } = require("../dominio/orden");
const { aWei, aEther } = require("../dominio/dinero");

const SEGUNDOS_POR_HORA = 3600;
const PLAZO_POR_DEFECTO_HORAS = 24;
const MONTO_POR_DEFECTO = "1";

function crearServicio({ ctx, repositorio }) {
  const { direcciones } = ctx;

  async function ordenNormalizada(clave) {
    return normalizarOrden(clave, await repositorio.verOrden(clave));
  }

  /** Respuesta común a toda operación que termina devolviendo una orden. */
  async function respuestaDeOrden(clave, recibo) {
    return { ok: true, tx: recibo.hash, orden: await ordenNormalizada(clave) };
  }

  async function saldosPorRol() {
    const saldos = {};
    for (const rol of ROLES) {
      const cuenta = direcciones[rol];
      saldos[rol] = cuenta ? aEther(await repositorio.saldoPendiente(cuenta)) : null;
    }
    return saldos;
  }

  function cuentasConfiguradas() {
    return Object.fromEntries(
      ROLES.filter((rol) => direcciones[rol]).map((rol) => [rol, direcciones[rol]])
    );
  }

  function plazoEnSegundos(plazoHoras, ahora) {
    const horas = Number(plazoHoras);
    if (!Number.isFinite(horas) || horas <= 0) {
      throw new ErrorAplicacion("plazoHoras debe ser un número mayor que 0");
    }
    return ahora + Math.max(1, Math.round(horas)) * SEGUNDOS_POR_HORA;
  }

  function salud() {
    return { ok: true, red: ctx.red, contrato: ctx.direccion };
  }

  async function estado() {
    return {
      red: ctx.red,
      contrato: ctx.direccion,
      arbitro: await repositorio.arbitro(),
      comisionBps: Number(await repositorio.comisionBps()),
      custodiaEther: aEther(await repositorio.totalEnCustodia()),
      balanceEther: aEther(await repositorio.balanceContrato()),
      cuentas: cuentasConfiguradas(),
      saldosPendientesEther: await saldosPorRol(),
      contabilidadCuadra: await repositorio.contabilidadCuadra(),
      pausado: await repositorio.pausado(),
    };
  }

  async function crearOrden({ id, vendedor, plazoHoras = PLAZO_POR_DEFECTO_HORAS } = {}) {
    const clave = aBytes32(id);
    const destino = aDireccion(vendedor || "vendedor", direcciones);
    const ahora = await repositorio.ultimoTimestamp();
    const plazo = plazoEnSegundos(plazoHoras, ahora);

    return respuestaDeOrden(clave, await repositorio.crearOrden(clave, destino, plazo));
  }

  async function financiar(id, { montoEther = MONTO_POR_DEFECTO } = {}) {
    const clave = aBytes32(id);
    return respuestaDeOrden(clave, await repositorio.financiar(clave, aWei(montoEther)));
  }

  const ACCIONES = {
    confirmar: (clave) => repositorio.confirmarEntrega(clave),
    cancelar: (clave) => repositorio.cancelar(clave),
    reclamar: (clave) => repositorio.reclamarVencimiento(clave),
    disputa: (clave) => repositorio.abrirDisputa(clave),
  };

  async function ejecutarAccion(nombre, id) {
    const accion = ACCIONES[nombre];
    if (!accion) throw new ErrorAplicacion(`Acción desconocida: ${nombre}`, 404);

    const clave = aBytes32(id);
    return respuestaDeOrden(clave, await accion(clave));
  }

  async function resolver(id, { aFavorDelVendedor } = {}) {
    const clave = aBytes32(id);
    const recibo = await repositorio.resolverDisputa(clave, Boolean(aFavorDelVendedor));
    return respuestaDeOrden(clave, recibo);
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
    return { ok: true, orden: await ordenNormalizada(clave) };
  }

  async function pausar() {
    const recibo = await repositorio.pausar();
    return { ok: true, pausado: true, tx: recibo.hash };
  }

  async function reanudar() {
    const recibo = await repositorio.reanudar();
    return { ok: true, pausado: false, tx: recibo.hash };
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
    pausar,
    reanudar,
  };
}

module.exports = { crearServicio };
