FROM node:20-slim

WORKDIR /app
COPY package.json ./
COPY index.js scanner.js ./

# No npm install needed -- zero runtime dependencies (Node built-ins only).

ENV PORT=3939
EXPOSE 3939

USER node
CMD ["node", "index.js"]
