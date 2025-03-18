FROM node:20-alpine

WORKDIR /app

# Sao chép package.json từ thư mục gốc monorepo
COPY package*.json ./

# Sao chép package.json của service
COPY apps/inventory-service/package*.json ./apps/inventory-service/

# Sao chép package.json của libs
COPY libs/common/package*.json ./libs/common/

# Cài đặt dependencies
RUN npm install

# Sao chép tất cả code
COPY . .

# Build service
RUN npm run build -w apps/inventory-service

# Port mà service sẽ lắng nghe
EXPOSE 3001

# Command để khởi động service
CMD ["node", "dist/apps/inventory-service/apps/inventory-service/src/main"]