FROM node:18-slim

# Install dependencies for Firefox
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    libdbus-glib-1-2 \
    libgtk-3-0 \
    libxt6 \
    --no-install-recommends

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci
# Force clean Playwright installation
RUN rm -rf /root/.cache/ms-playwright
# Install only Chromium for minimal, reliable Playwright scraping
RUN npx playwright install chromium --with-deps
# Verify installation
RUN ls -la /root/.cache/ms-playwright/chromium*
# Firefox installation removed to minimize image size

# Copy app source - First copy API files
COPY . .

# Create directory structure
RUN mkdir -p /app/services
RUN mkdir -p /app/utils

# Copy services and utils directories from parent directory
# NOTE: This requires the correct directory structure during build
COPY ../services/ /app/services/
COPY ../utils/ /app/utils/

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]