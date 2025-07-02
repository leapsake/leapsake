FROM node:22-alpine AS base
WORKDIR /app

COPY apps/server/package*.json ./
COPY apps/server ./

RUN npm ci
RUN npm run build

FROM node:18-alpine AS runtime
WORKDIR /app

COPY --from=base /app/dist ./
COPY --from=base /app/node_modules ./node_modules

RUN mkdir -p /app/data && chown -R 1001:1001 /app/data

RUN addgroup -g 1001 -S nodejs
RUN adduser -S express -u 1001
USER express

EXPOSE 3333
CMD ["node", "main.js"]
