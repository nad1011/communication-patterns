FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY apps/order-service/package*.json ./apps/order-service/

COPY libs/common/package*.json ./libs/common/

RUN npm install

COPY . .

RUN npm run build -w apps/order-service

EXPOSE 3000

CMD ["node", "dist/apps/order-service/apps/order-service/src/main"]