FROM mcr.microsoft.com/playwright:v1.59.1-jammy

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    fluxbox \
    websockify \
    net-tools \
    autocutsel \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/browser-core/package.json packages/browser-core/
COPY packages/database/package.json packages/database/
COPY packages/shared-types/package.json packages/shared-types/

RUN npm install

COPY . .

RUN npm run build --workspaces --if-present
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

EXPOSE 3001 5173

CMD ["npm", "run", "dev"]
