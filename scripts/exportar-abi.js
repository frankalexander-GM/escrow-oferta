/**
 * Exporta el ABI y el bytecode del artefacto compilado a servidor/abi.
 * Así el servidor no depende de la carpeta artifacts (que no se publica) y
 * nunca queda una copia desactualizada: se regenera en cada compilación.
 */
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const ORIGEN = path.join(RAIZ, "artifacts", "contracts", "EscrowOferta.sol", "EscrowOferta.json");
const DESTINO = path.join(RAIZ, "servidor", "abi", "EscrowOferta.json");

if (!fs.existsSync(ORIGEN)) {
  console.error(`No existe el artefacto compilado: ${ORIGEN}`);
  console.error("Ejecuta antes: npx hardhat compile");
  process.exit(1);
}

const artefacto = JSON.parse(fs.readFileSync(ORIGEN, "utf8"));

if (!artefacto.abi || !artefacto.bytecode || artefacto.bytecode === "0x") {
  console.error("El artefacto no tiene ABI o bytecode válidos.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(
  DESTINO,
  `${JSON.stringify({ abi: artefacto.abi, bytecode: artefacto.bytecode }, null, 2)}\n`,
  "utf8"
);

const entradas = artefacto.abi.length;
const bytes = (artefacto.bytecode.length - 2) / 2;
console.log(`[abi] ${entradas} entradas y ${bytes} bytes → servidor/abi/EscrowOferta.json`);
