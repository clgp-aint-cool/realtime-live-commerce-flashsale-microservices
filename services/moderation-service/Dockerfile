# Placeholder: thay bằng Dockerfile multi-stage cho NestJS khi có code thật.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
USER node
EXPOSE 3004
CMD ["node", "src/main.js"]
