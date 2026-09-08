FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .
CMD ["node", "bot.js"]
