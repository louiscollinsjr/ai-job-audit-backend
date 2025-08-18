FROM node:18-slim

# Install system dependencies required by Chromium/Playwright and fonts
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    fonts-noto \
    fonts-noto-color-emoji \
    tzdata \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install
# Explicitly install openai package
RUN npm install openai@4.28.0 --save
# Install Playwright browsers (Chromium)
RUN npx playwright install chromium --with-deps

# Copy app source - copy all backend directories
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "api/server.js"]
