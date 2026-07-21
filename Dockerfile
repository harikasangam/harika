# Single container: Express serves both the API and the static frontend.
# This is what you point AWS App Runner / Elastic Beanstalk at.

FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm install --omit=dev

COPY backend/server.js ./
COPY frontend ./public

ENV PORT=3000
EXPOSE 3000

# Run as non-root
USER node

CMD ["node", "server.js"]
