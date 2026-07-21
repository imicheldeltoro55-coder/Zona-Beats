# Imagen con Node 22 (requerido para node:sqlite nativo) sobre Debian, para poder instalar ffmpeg via apt.
FROM node:22-bookworm-slim

# ffmpeg es necesario para mezclar la marca de agua audible sobre cada pista subida.
# Sin esto, la protección de audio (Panel admin > Protección de audio) fallará al procesar.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# No hay dependencias npm externas en este proyecto, pero se copia primero por si acaso
# se agregan en el futuro (aprovecha el cache de capas de Docker).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true

COPY . .

# Aseguramos que las carpetas de datos existan (Railway monta el Volume sobre estas rutas).
RUN mkdir -p db uploads/audio uploads/covers uploads/receipts uploads/watermark uploads/tmp

EXPOSE 3000

CMD ["node", "server.js"]
