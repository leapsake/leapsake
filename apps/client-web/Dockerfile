FROM node:22-alpine AS base
WORKDIR /app

COPY apps/client-web/package*.json ./
COPY apps/client-web ./

RUN npm ci
RUN npm run build

FROM node:18-alpine AS runtime
WORKDIR /app

COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

EXPOSE 3000
CMD ["node", "server.js"]
