FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# Brauzerni npm o'rnatgan versiyaga moslab qayta o'rnatamiz.
# Image tegi bilan paket versiyasi farq qilsa ham ishlaydi.
RUN npx playwright install chromium

COPY . .
CMD ["node", "bot.js"]
