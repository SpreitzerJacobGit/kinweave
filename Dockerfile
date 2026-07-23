FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:web
ENV PORT=8788
EXPOSE 8788
CMD ["npx", "tsx", "server/index.ts"]
