FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
# Use npm install which generates lockfile if missing (more robust for initial deploy)
RUN npm install --production

# Copy all files (including the nested chatbot folder, technically, but we won't run it here)
# To be cleaner, we might want to exclude chatbot via .dockerignore, but it doesn't hurt much.
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
