FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY apps/order-service/package*.json ./apps/order-service/

COPY libs/common/package*.json ./libs/common/

RUN npm config set registry https://registry.npmmirror.com/ && \
    npm cache clean --force && \
    npm install --no-fund --no-audit

COPY . .

RUN npm run build -w apps/order-service

EXPOSE 3000

CMD ["node", "dist/apps/order-service/apps/order-service/src/main"]