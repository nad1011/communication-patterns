FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY apps/inventory-service/package*.json ./apps/inventory-service/

COPY libs/common/package*.json ./libs/common/

RUN npm config set registry https://registry.npmmirror.com/ && \
    npm cache clean --force && \
    npm install --no-fund --no-audit

COPY . .

RUN npm run build -w apps/inventory-service

EXPOSE 3001

# Command to start service
CMD ["node", "dist/apps/inventory-service/apps/inventory-service/src/main"]