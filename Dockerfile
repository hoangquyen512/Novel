FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js index.html change-version.js ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3456

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3456/api/health || exit 1

CMD ["npm", "start"]
