FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src/domain ./src/domain
COPY --from=build --chown=node:node /app/scripts/setup-owner.ts ./scripts/setup-owner.ts
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production ALLOWANCE_DATA_DIR=/data ALLOWANCE_BIND=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "require('node:http').get('http://127.0.0.1:3000/api/health',{headers:{host:new URL(process.env.ALLOWANCE_ORIGIN).host},timeout:4000},r=>{r.resume();if(r.statusCode!==200)process.exit(1)}).on('timeout',()=>process.exit(1)).on('error',()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/main.ts"]
