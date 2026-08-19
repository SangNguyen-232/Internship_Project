# Dùng Node.js 20 trên Alpine Linux (image nhỏ gọn)
FROM node:20-alpine

# Tạo thư mục làm việc trong container
WORKDIR /app

# Copy package.json và package-lock.json trước (tận dụng Docker cache)
COPY package*.json ./

# Cài dependencies (chỉ production)
RUN npm install --omit=dev

# Copy toàn bộ source code backend vào container
COPY . .

# Expose port 3000
EXPOSE 3000

# Lệnh khởi động server
CMD ["node", "index.js"]