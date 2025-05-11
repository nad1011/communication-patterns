FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY apps/email-service/package*.json ./apps/email-service/

COPY libs/common/package*.json ./libs/common/

RUN npm config set registry https://registry.npmmirror.com/ && \
    npm cache clean --force && \
    npm install --no-fund --no-audit

COPY . .

RUN npm run build -w apps/email-service

EXPOSE 3003

CMD ["node", "dist/apps/email-service/apps/email-service/src/main"]