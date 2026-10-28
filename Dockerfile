FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_FILE=/data/ishtaxa.db

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Ma'lumotlar bazasi uchun doimiy joy (hostingda shu yoʻlga volume ulang)
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
