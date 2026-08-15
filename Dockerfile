FROM node:20-alpine

WORKDIR /app

# Copy package.json and lockfile (if exists)
COPY package.json package-lock.json* ./
# Install only locked production dependencies.
RUN npm ci --omit=dev

# .dockerignore excludes the retired local-ML runtime and local credentials.
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
