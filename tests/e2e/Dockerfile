FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY run.mjs ./
USER node
CMD ["node", "run.mjs"]
