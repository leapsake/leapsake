FROM node:22-alpine AS base
WORKDIR /app

COPY package*.json nx.json tsconfig*.json ./
COPY apps/client-web ./apps/client-web
# COPY libs ./libs

RUN npm ci
RUN npx nx build client-web --prod

FROM node:18-alpine AS runtime
WORKDIR /app

COPY --from=base /app/dist/apps/client-web ./

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

EXPOSE 3000
CMD ["npm", "start"]
