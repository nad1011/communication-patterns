FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY apps/payment-service/package*.json ./apps/payment-service/

COPY libs/common/package*.json ./libs/common/

RUN npm config set registry https://registry.npmmirror.com/ && \
    npm cache clean --force && \
    npm install --no-fund --no-audit

COPY . .

RUN npm run build -w apps/payment-service

EXPOSE 3002

CMD ["node", "dist/apps/payment-service/apps/payment-service/src/main"]