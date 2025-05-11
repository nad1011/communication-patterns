FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY apps/fraud-service/package*.json ./apps/fraud-service/

COPY libs/common/package*.json ./libs/common/

RUN npm config set registry https://registry.npmmirror.com/ && \
    npm cache clean --force && \
    npm install --no-fund --no-audit

COPY . .

RUN npm run build -w apps/fraud-service

EXPOSE 3006

CMD ["node", "dist/apps/fraud-service/apps/fraud-service/src/main"]