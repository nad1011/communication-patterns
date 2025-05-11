FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY apps/notification-service/package*.json ./apps/notification-service/

COPY libs/common/package*.json ./libs/common/

RUN npm config set registry https://registry.npmmirror.com/ && \
    npm cache clean --force && \
    npm install --no-fund --no-audit

COPY . .

RUN npm run build -w apps/notification-service

EXPOSE 3004

CMD ["node", "dist/apps/notification-service/apps/notification-service/src/main"]