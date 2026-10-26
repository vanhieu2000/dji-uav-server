FROM node:20-slim

WORKDIR /app

# Cài đặt các thư viện hệ thống cần thiết cho DJI Thermal SDK Linux x64
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production

COPY . .

# Cấp quyền thực thi cho DJI Thermal SDK binary Linux
RUN chmod +x ./tsdk/utility/bin/linux/release_x64/dji_irp || true

EXPOSE 8080
EXPOSE 1883
EXPOSE 1935
EXPOSE 8000

CMD ["node", "server.js"]
