FROM node:18-alpine AS base
WORKDIR /app

COPY package*.json nx.json tsconfig*.json ./
COPY apps/server ./apps/server
# COPY libs ./libs

RUN npm ci
RUN npx nx build server --prod

FROM node:18-alpine AS runtime
WORKDIR /app

COPY --from=base /app/dist/apps/server ./
COPY --from=base /app/node_modules ./node_modules

RUN mkdir -p /app/data && chown -R 1001:1001 /app/data

RUN addgroup -g 1001 -S nodejs
RUN adduser -S express -u 1001
USER express

EXPOSE 3333
CMD ["node", "main.js"]
