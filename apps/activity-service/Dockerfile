FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY apps/activity-service/package*.json ./apps/activity-service/

COPY libs/common/package*.json ./libs/common/

RUN npm config set registry https://registry.npmmirror.com/ && \
    npm cache clean --force && \
    npm install --no-fund --no-audit

COPY . .

RUN npm run build -w apps/activity-service

EXPOSE 3005

# Command to start service
CMD ["node", "dist/apps/activity-service/apps/activity-service/src/main"]