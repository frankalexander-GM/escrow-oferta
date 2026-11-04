const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const id = (texto) => ethers.keccak256(ethers.toUtf8Bytes(texto));

const PRECIO = ethers.parseEther("1");
const COMISION_BPS = 350n; // 3,5 %
const COMISION = (PRECIO * COMISION_BPS) / 10_000n;
const AL_VENDEDOR = PRECIO - COMISION;
const SIETE_DIAS = 7 * 24 * 60 * 60;

describe("EscrowOferta", function () {
  let escrow;
  let comprador, vendedor, arbitro, intruso;

  async function desplegar(comisionBps = COMISION_BPS) {
    const Fabrica = await ethers.getContractFactory("EscrowOferta");
    const contrato = await Fabrica.deploy(arbitro.address, comisionBps);
    await contrato.waitForDeployment();
    return contrato;
  }

  async function invariante() {
    const saldoContrato = await ethers.provider.getBalance(await escrow.getAddress());
    const custodia = await escrow.totalEnCustodia();
    const cuentas = await Promise.all(
      [comprador, vendedor, arbitro, intruso].map((s) => escrow.saldoPendiente(s.address))
    );
    const pendientes = cuentas.reduce((a, b) => a + b, 0n);

    expect(saldoContrato).to.equal(custodia + pendientes);
    expect(await escrow.contabilidadCuadra()).to.equal(true);
    return { saldoContrato, custodia, pendientes };
  }

  beforeEach(async () => {
    [comprador, vendedor, arbitro, intruso] = await ethers.getSigners();
    escrow = await desplegar();
  });

  describe("despliegue", function () {
    it("guarda árbitro y comisión", async function () {
      expect(await escrow.arbitro()).to.equal(arbitro.address);
      expect(await escrow.comisionBps()).to.equal(COMISION_BPS);
    });

    it("rechaza una comisión por encima del 10 %", async function () {
      const Fabrica = await ethers.getContractFactory("EscrowOferta");
      await expect(Fabrica.deploy(arbitro.address, 1001)).to.be.revertedWithCustomError(
        Fabrica,
        "ComisionExcesiva"
      );
    });

    it("rechaza un árbitro nulo", async function () {
      const Fabrica = await ethers.getContractFactory("EscrowOferta");
      await expect(Fabrica.deploy(ethers.ZeroAddress, COMISION_BPS)).to.be.revertedWithCustomError(
        Fabrica,
        "NoAutorizado"
      );
    });
  });

  describe("flujo feliz", function () {
    it("retiene, libera al confirmar y reparte comisión", async function () {
      const plazo = (await time.latest()) + SIETE_DIAS;

      await escrow.connect(comprador).crearOrden(id("oferta-1"), vendedor.address, plazo);
      await expect(escrow.connect(comprador).financiar(id("oferta-1"), { value: PRECIO }))
        .to.emit(escrow, "OrdenFinanciada")
        .withArgs(id("oferta-1"), PRECIO);

      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(PRECIO);
      expect(await escrow.totalEnCustodia()).to.equal(PRECIO);

      await expect(escrow.connect(comprador).confirmarEntrega(id("oferta-1")))
        .to.emit(escrow, "EntregaConfirmada")
        .withArgs(id("oferta-1"), AL_VENDEDOR, COMISION);

      expect(await escrow.totalEnCustodia()).to.equal(0n);
      expect(await escrow.saldoPendiente(vendedor.address)).to.equal(AL_VENDEDOR);
      expect(await escrow.saldoPendiente(arbitro.address)).to.equal(COMISION);

      // El vendedor cobra su parte
      await expect(escrow.connect(vendedor).retirar()).to.changeEtherBalance(vendedor, AL_VENDEDOR);

      // La plataforma cobra la comisión
      await expect(escrow.connect(arbitro).retirar()).to.changeEtherBalance(arbitro, COMISION);

      // Nadie puede retirar dos veces
      await expect(escrow.connect(vendedor).retirar()).to.be.revertedWithCustomError(
        escrow,
        "SinSaldo"
      );

      await invariante();
    });
  });

  describe("reglas de acceso y estado", function () {
    let plazo;

    beforeEach(async () => {
      plazo = (await time.latest()) + SIETE_DIAS;
      await escrow.connect(comprador).crearOrden(id("oferta-1"), vendedor.address, plazo);
    });

    it("solo el comprador financia", async function () {
      await expect(
        escrow.connect(intruso).financiar(id("oferta-1"), { value: PRECIO })
      ).to.be.revertedWithCustomError(escrow, "NoAutorizado");
    });

    it("no se puede financiar dos veces", async function () {
      await escrow.connect(comprador).financiar(id("oferta-1"), { value: PRECIO });
      await expect(
        escrow.connect(comprador).financiar(id("oferta-1"), { value: PRECIO })
      ).to.be.revertedWithCustomError(escrow, "EstadoInvalido");
    });

    it("no se puede financiar con importe cero", async function () {
      await expect(
        escrow.connect(comprador).financiar(id("oferta-1"), { value: 0 })
      ).to.be.revertedWithCustomError(escrow, "ImporteInvalido");
    });

    it("ni el vendedor ni un tercero pueden confirmar la entrega", async function () {
      await escrow.connect(comprador).financiar(id("oferta-1"), { value: PRECIO });

      await expect(
        escrow.connect(vendedor).confirmarEntrega(id("oferta-1"))
      ).to.be.revertedWithCustomError(escrow, "NoAutorizado");
      await expect(
        escrow.connect(intruso).confirmarEntrega(id("oferta-1"))
      ).to.be.revertedWithCustomError(escrow, "NoAutorizado");
    });

    it("no se puede crear dos veces el mismo id", async function () {
      await expect(
        escrow.connect(comprador).crearOrden(id("oferta-1"), intruso.address, plazo)
      ).to.be.revertedWithCustomError(escrow, "EstadoInvalido");
    });

    it("rechaza plazos ya vencidos", async function () {
      await expect(
        escrow
          .connect(comprador)
          .crearOrden(id("otra"), vendedor.address, (await time.latest()) - 1)
      ).to.be.revertedWithCustomError(escrow, "PlazoInvalido");
    });

    it("rechaza ETH enviado directamente", async function () {
      await expect(
        comprador.sendTransaction({ to: await escrow.getAddress(), value: 1n })
      ).to.be.revertedWithCustomError(escrow, "NoAceptaEtherDirecto");
    });
  });

  describe("vencimiento y cancelación", function () {
    it("devuelve el dinero al comprador al vencer el plazo", async function () {
      const plazo = (await time.latest()) + SIETE_DIAS;
      await escrow.connect(comprador).crearOrden(id("oferta-1"), vendedor.address, plazo);
      await escrow.connect(comprador).financiar(id("oferta-1"), { value: PRECIO });

      await expect(
        escrow.connect(comprador).reclamarVencimiento(id("oferta-1"))
      ).to.be.revertedWithCustomError(escrow, "AunNoVencida");

      await time.increaseTo(plazo + 1);

      // Cualquiera puede disparar la devolución, no solo el comprador
      await expect(escrow.connect(intruso).reclamarVencimiento(id("oferta-1")))
        .to.emit(escrow, "Reembolso")
        .withArgs(id("oferta-1"), comprador.address, PRECIO);

      expect(await escrow.saldoPendiente(comprador.address)).to.equal(PRECIO);
      expect(await escrow.saldoPendiente(vendedor.address)).to.equal(0n);

      await expect(escrow.connect(comprador).retirar()).to.changeEtherBalance(comprador, PRECIO);
      await invariante();
    });

    it("el vendedor puede cancelar y devolver sin esperar", async function () {
      const plazo = (await time.latest()) + SIETE_DIAS;
      await escrow.connect(comprador).crearOrden(id("oferta-1"), vendedor.address, plazo);
      await escrow.connect(comprador).financiar(id("oferta-1"), { value: PRECIO });

      await escrow.connect(vendedor).cancelar(id("oferta-1"));
      expect(await escrow.saldoPendiente(comprador.address)).to.equal(PRECIO);

      // Ya no se puede confirmar una entrega sobre algo devuelto
      await expect(
        escrow.connect(comprador).confirmarEntrega(id("oferta-1"))
      ).to.be.revertedWithCustomError(escrow, "EstadoInvalido");

      await invariante();
    });

    it("el comprador no puede cancelar por su cuenta", async function () {
      const plazo = (await time.latest()) + SIETE_DIAS;
      await escrow.connect(comprador).crearOrden(id("oferta-1"), vendedor.address, plazo);
      await escrow.connect(comprador).financiar(id("oferta-1"), { value: PRECIO });

      await expect(
        escrow.connect(comprador).cancelar(id("oferta-1"))
      ).to.be.revertedWithCustomError(escrow, "NoAutorizado");
    });
  });

  describe("disputas", function () {
    let plazo;

    beforeEach(async () => {
      plazo = (await time.latest()) + SIETE_DIAS;
      await escrow.connect(comprador).crearOrden(id("oferta-1"), vendedor.address, plazo);
      await escrow.connect(comprador).financiar(id("oferta-1"), { value: PRECIO });
    });

    it("solo comprador o vendedor abren la disputa", async function () {
      await expect(
        escrow.connect(intruso).abrirDisputa(id("oferta-1"))
      ).to.be.revertedWithCustomError(escrow, "NoAutorizado");

      await expect(escrow.connect(vendedor).abrirDisputa(id("oferta-1")))
        .to.emit(escrow, "DisputaAbierta")
        .withArgs(id("oferta-1"), vendedor.address);
    });

    it("solo el árbitro resuelve", async function () {
      await escrow.connect(comprador).abrirDisputa(id("oferta-1"));

      await expect(
        escrow.connect(comprador).resolverDisputa(id("oferta-1"), true)
      ).to.be.revertedWithCustomError(escrow, "NoAutorizado");
    });

    it("a favor del vendedor: cobra con comisión", async function () {
      await escrow.connect(comprador).abrirDisputa(id("oferta-1"));

      await expect(escrow.connect(arbitro).resolverDisputa(id("oferta-1"), true))
        .to.emit(escrow, "DisputaResuelta")
        .withArgs(id("oferta-1"), true);

      expect(await escrow.saldoPendiente(vendedor.address)).to.equal(AL_VENDEDOR);
      expect(await escrow.saldoPendiente(arbitro.address)).to.equal(COMISION);
      expect(await escrow.saldoPendiente(comprador.address)).to.equal(0n);

      await invariante();
    });

    it("a favor del comprador: devuelve todo y sin comisión", async function () {
      await escrow.connect(comprador).abrirDisputa(id("oferta-1"));
      await escrow.connect(arbitro).resolverDisputa(id("oferta-1"), false);

      expect(await escrow.saldoPendiente(comprador.address)).to.equal(PRECIO);
      expect(await escrow.saldoPendiente(arbitro.address)).to.equal(0n);

      await invariante();
    });

    it("una disputa cerrada no se reabre", async function () {
      await escrow.connect(comprador).abrirDisputa(id("oferta-1"));
      await escrow.connect(arbitro).resolverDisputa(id("oferta-1"), false);

      await expect(
        escrow.connect(comprador).abrirDisputa(id("oferta-1"))
      ).to.be.revertedWithCustomError(escrow, "EstadoInvalido");
    });
  });

  describe("contabilidad", function () {
    it("cuadra con varias órdenes activas y cerradas a la vez", async function () {
      const plazo = (await time.latest()) + SIETE_DIAS;
      const precios = [ethers.parseEther("0.3"), ethers.parseEther("2"), ethers.parseEther("0.05")];

      for (let i = 0; i < precios.length; i++) {
        await escrow.connect(comprador).crearOrden(id(`oferta-${i}`), vendedor.address, plazo);
        await escrow.connect(comprador).financiar(id(`oferta-${i}`), { value: precios[i] });
      }

      await escrow.connect(comprador).confirmarEntrega(id("oferta-1"));
      await escrow.connect(comprador).abrirDisputa(id("oferta-2"));

      const { custodia } = await invariante();
      expect(custodia).to.equal(precios[0] + precios[2]);

      await escrow.connect(arbitro).resolverDisputa(id("oferta-2"), false);
      await escrow.connect(comprador).confirmarEntrega(id("oferta-0"));

      const final = await invariante();
      expect(final.custodia).to.equal(0n);

      await escrow.connect(vendedor).retirar();
      await escrow.connect(arbitro).retirar();
      await escrow.connect(comprador).retirar();

      await invariante();
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    });
  });
});
