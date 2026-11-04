/**
 * Infraestructura: todo lo que habla con la blockchain.
 * Si mañana se cambia ethers por viem, o ETH por USDC, solo se toca esta capa.
 */
const { ethers } = require("ethers");
const { ROLES } = require("../dominio/orden");
const { ErrorAplicacion } = require("../dominio/errores");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** La cadena puede tardar en levantar (healthcheck de Docker). */
async function esperarRpc(provider, intentos = 60) {
  let ultimoError;
  for (let intento = 0; intento < intentos; intento++) {
    try {
      await provider.getBlockNumber();
      return;
    } catch (error) {
      ultimoError = error;
      await dormir(1000);
    }
  }
  throw ultimoError;
}

async function conectar(config, artefacto) {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  await esperarRpc(provider);

  const billeteras = {};
  const direcciones = {};
  const firmantes = {};

  for (const rol of ROLES) {
    const clave = config.claves[rol];
    if (!clave) continue;
    const billetera = new ethers.Wallet(clave, provider);
    billeteras[rol] = billetera;
    direcciones[rol] = billetera.address;
    // NonceManager: sin él, dos envíos seguidos reutilizan el nonce y la
    // segunda transacción muere con "nonce has already been used".
    firmantes[rol] = new ethers.NonceManager(billetera);
  }

  let direccion = config.contratoDireccion;

  if (direccion && ethers.isAddress(direccion)) {
    const codigo = await provider.getCode(direccion);
    if (codigo === "0x") {
      console.warn(`[aviso] No hay contrato en ${direccion}; se desplegará uno nuevo.`);
      direccion = "";
    }
  }

  let contrato = null;

  if (!direccion) {
    if (!billeteras.arbitro) {
      throw new ErrorAplicacion(
        "No hay contrato desplegado y falta CLAVE_ARBITRO para desplegarlo.",
        503
      );
    }
    const fabrica = new ethers.ContractFactory(
      artefacto.abi,
      artefacto.bytecode,
      billeteras.arbitro
    );
    contrato = await fabrica.deploy(billeteras.arbitro.address, config.comisionBps);
    await contrato.waitForDeployment();
    direccion = await contrato.getAddress();
    console.log(`[escrow] Contrato desplegado en ${direccion}`);
  } else {
    console.log(`[escrow] Usando contrato existente en ${direccion}`);
  }

  if (!contrato) contrato = new ethers.Contract(direccion, artefacto.abi, provider);

  const red = await provider.getNetwork();
  const ctx = {
    provider,
    billeteras,
    direcciones,
    firmantes,
    contrato,
    direccion,
    red: `${red.name} (${red.chainId})`,
  };

  console.log(`[escrow] Red: ${ctx.red}`);
  console.log(`[escrow] Árbitro: ${await contrato.arbitro()}`);

  return ctx;
}

module.exports = { conectar };
