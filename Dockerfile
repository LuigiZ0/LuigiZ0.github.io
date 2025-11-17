FROM node:18-alpine

WORKDIR /app

# Copia e instala dependências
COPY package*.json ./
RUN npm install --production

# Copia o código do addon
COPY . .

# Define a porta que o Koyeb vai usar
ENV PORT=8000
EXPOSE 8000

# Inicia o addon
CMD ["node", "index.js"]
