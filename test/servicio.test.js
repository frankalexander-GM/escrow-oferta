const { expect } = require("chai");
const { ethers } = require("hardhat");
const { crearServicio } = require("../servidor/servicios/escrowServicio");

const CUENTAS = {
  arbitro: "0x1000000000000000000000000000000000000001",
  comprador: "0x1000000000000000000000000000000000000002",
  vendedor: "0x1000000000000000000000000000000000000003",
};

/** Devuelve el mensaje del error esperado, sin depender de plugins de chai. */
async function mensajeDeError(promesa) {
  try {
    await promesa();
  } catch (error) {
    return error.message;
  }
  throw new Error("Se esperaba un error y no se lanzó ninguno");
}

const ORDEN_FINANCIADA = {
  comprador: CUENTAS.comprador,
  vendedor: CUENTAS.vendedor,
  monto: ethers.parseEther("1"),
  plazoEntrega: 1_700_000_000n,
  estado: 2, // Financiado
};

/**
 * Repositorio falso: ni cadena, ni ethers, ni red. Si el servicio funciona
 * contra esto, es que no depende de la infraestructura.
 */
function crearRepositorioFalso({ saldos = {}, estadoOrden = ORDEN_FINANCIADA } = {}) {
  const llamadas = [];
  const anotar =
    (nombre, resultado = { hash: `0x${nombre}` }) =>
    async (...args) => {
      llamadas.push({ nombre, args });
      return resultado;
    };

  return {
    llamadas,
    verOrden: async () => estadoOrden,
    saldoPendiente: async (cuenta) => saldos[cuenta] ?? 0n,
    totalEnCustodia: async () => ethers.parseEther("1"),
    balanceContrato: async () => ethers.parseEther("1"),
    arbitro: async () => CUENTAS.arbitro,
    comisionBps: async () => 350n,
    contabilidadCuadra: async () => true,
    pausado: async () => false,
    ultimoTimestamp: async () => 1_700_000_000,
    crearOrden: anotar("crearOrden"),
    financiar: anotar("financiar"),
    confirmarEntrega: anotar("confirmarEntrega"),
    cancelar: anotar("cancelar"),
    reclamarVencimiento: anotar("reclamarVencimiento"),
    abrirDisputa: anotar("abrirDisputa"),
    resolverDisputa: anotar("resolverDisputa"),
    retirar: anotar("retirar"),
    pausar: anotar("pausar"),
    reanudar: anotar("reanudar"),
  };
}

function crearServicioDePrueba(opciones) {
  const repositorio = crearRepositorioFalso(opciones);
  const ctx = {
    red: "test (31337)",
    direccion: "0x2000000000000000000000000000000000000001",
    direcciones: { ...CUENTAS },
  };
  return { servicio: crearServicio({ ctx, repositorio }), repositorio };
}

describe("Servicio de escrow (sin cadena)", function () {
  it("crea la orden con el id convertido a bytes32 y el plazo en el futuro", async function () {
    const { servicio, repositorio } = crearServicioDePrueba();

    const resultado = await servicio.crearOrden({
      id: "oferta-1",
      vendedor: "vendedor",
      plazoHoras: 24,
    });

    const llamada = repositorio.llamadas.find((l) => l.nombre === "crearOrden");
    expect(llamada).to.not.equal(undefined);

    const [clave, vendedor, plazo] = llamada.args;
    expect(clave).to.equal(ethers.keccak256(ethers.toUtf8Bytes("oferta-1")));
    expect(vendedor).to.equal(CUENTAS.vendedor);
    expect(plazo).to.equal(1_700_000_000 + 24 * 3600);

    expect(resultado.ok).to.equal(true);
    expect(resultado.orden.estado).to.equal("Financiado");
  });

  it("rechaza un plazo inválido sin llamar al repositorio", async function () {
    const { servicio, repositorio } = crearServicioDePrueba();

    const mensaje = await mensajeDeError(() => servicio.crearOrden({ id: "x", plazoHoras: 0 }));

    expect(mensaje).to.equal("plazoHoras debe ser un número mayor que 0");
    expect(repositorio.llamadas).to.have.lengthOf(0);
  });

  it("rechaza un importe de cero antes de tocar la cadena", async function () {
    const { servicio, repositorio } = crearServicioDePrueba();

    const mensaje = await mensajeDeError(() => servicio.financiar("x", { montoEther: "0" }));

    expect(mensaje).to.equal("El importe debe ser mayor que 0");
    expect(repositorio.llamadas).to.have.lengthOf(0);
  });

  it("no deja retirar a quien no tiene saldo", async function () {
    const { servicio } = crearServicioDePrueba({ saldos: { [CUENTAS.vendedor]: 0n } });

    const mensaje = await mensajeDeError(() => servicio.retirar({ rol: "vendedor" }));
    expect(mensaje).to.include("no tiene saldo pendiente");
  });

  it("devuelve el importe retirado ya formateado", async function () {
    const { servicio, repositorio } = crearServicioDePrueba({
      saldos: { [CUENTAS.vendedor]: ethers.parseEther("0.4825") },
    });

    const resultado = await servicio.retirar({ rol: "vendedor" });

    expect(resultado.retiradoEther).to.equal("0.4825");
    expect(repositorio.llamadas.map((l) => l.nombre)).to.deep.equal(["retirar"]);
  });

  it("rechaza roles desconocidos", async function () {
    const { servicio } = crearServicioDePrueba();
    const mensaje = await mensajeDeError(() => servicio.retirar({ rol: "intruso" }));
    expect(mensaje).to.include("Rol inválido");
  });

  it("resuelve una disputa a favor del comprador sin conocer ethers", async function () {
    const { servicio, repositorio } = crearServicioDePrueba();

    await servicio.resolver("oferta-1", { aFavorDelVendedor: false });

    const llamada = repositorio.llamadas.find((l) => l.nombre === "resolverDisputa");
    expect(llamada.args[1]).to.equal(false);
  });

  it("publica el estado con los saldos por rol", async function () {
    const { servicio } = crearServicioDePrueba({
      saldos: { [CUENTAS.vendedor]: ethers.parseEther("0.4825") },
    });

    const estado = await servicio.estado();

    expect(estado.comisionBps).to.equal(350);
    expect(estado.custodiaEther).to.equal("1.0");
    expect(estado.saldosPendientesEther.vendedor).to.equal("0.4825");
    expect(estado.contabilidadCuadra).to.equal(true);
  });
});
