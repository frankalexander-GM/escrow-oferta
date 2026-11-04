FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# El lockfile garantiza instalaciones reproducibles.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Contrato y utilidades: se compilan dentro de la imagen, así el repositorio no
# versiona artefactos generados y el ABI nunca puede quedar desactualizado.
COPY hardhat.config.js ./
COPY contracts ./contracts
COPY scripts ./scripts
RUN npx hardhat compile && node scripts/exportar-abi.js

COPY servidor ./servidor

EXPOSE 3000

CMD ["node", "servidor/index.js"]
