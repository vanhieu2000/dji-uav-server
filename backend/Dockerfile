FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --cache /tmp/npm-cache && rm -rf /tmp/npm-cache
COPY --chown=node:node . .
RUN mkdir -p /app/data /app/uploads/media /app/uploads/tmp /app/uploads/waylines /app/tiles && chown -R node:node /app/data /app/uploads /app/tiles
USER node
EXPOSE 8080 1883 1935 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(async r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.js"]
