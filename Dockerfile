# Etapa 1: build de la aplicación
FROM node:22-alpine AS builder

# Crear directorio de trabajo
WORKDIR /app

# Copiar sólo los archivos necesarios para instalar dependencias
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

# Instalar dependencias (usa npm por defecto; si prefieres yarn, adapta esto)
RUN npm install

# Copiar el resto del código de la app
COPY . .

# Compilar la aplicación Next.js en modo producción
ENV NODE_ENV=production
RUN mkdir -p public
RUN npm run build

# Etapa 2: runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Copiar sólo lo necesario desde la etapa de build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

ENV NODE_ENV=production

# Next.js por defecto escucha en el puerto 3000
EXPOSE 3000

# Comando de inicio en producción
CMD ["npm", "run", "start"]
