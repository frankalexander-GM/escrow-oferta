const { ethers } = require("hardhat");

async function main() {
  const [desplegador, vendedorDemo] = await ethers.getSigners();

  // Árbitro por defecto: la cuenta que despliega (cámbialo en producción).
  const arbitro = process.env.ARBITRO || desplegador.address;
  const comisionBps = Number(process.env.COMISION_BPS || 350); // 3,5 %

  console.log("Desplegando desde:", desplegador.address);
  console.log("Árbitro:", arbitro);
  console.log("Comisión (bps):", comisionBps);

  const Fabrica = await ethers.getContractFactory("EscrowOferta");
  const contrato = await Fabrica.deploy(arbitro, comisionBps);
  await contrato.waitForDeployment();

  const direccion = await contrato.getAddress();
  console.log("\nEscrowOferta desplegado en:", direccion);
  console.log("Red:", (await ethers.provider.getNetwork()).name);

  // Primera orden de prueba, para verificar que responde.
  const id = ethers.keccak256(ethers.toUtf8Bytes("oferta-demo"));
  const plazo = (await ethers.provider.getBlock("latest")).timestamp + 7 * 24 * 60 * 60;

  const tx = await contrato.crearOrden(id, vendedorDemo.address, plazo);
  await tx.wait();
  console.log("Orden de prueba creada con id:", id);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
