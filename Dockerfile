FROM node:18

# Instalar dependencias necesarias
RUN apt-get update && apt-get install -y tesseract-ocr

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos del proyecto
COPY package.json ./
RUN npm install

COPY . .

# Exponer el puerto
EXPOSE 3000

# Comando para iniciar el servidor
CMD ["node", "server.js"]
