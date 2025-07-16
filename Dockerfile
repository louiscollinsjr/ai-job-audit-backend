FROM node:18-slim

# Install dependencies for Playwright
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
    --no-install-recommends

# Install dependencies for Firefox
RUN apt-get install -y \
    libasound2 \
    libdbus-glib-1-2 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxt6

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install
# Explicitly install openai package
RUN npm install openai@4.28.0 --save
# Install Playwright browsers
RUN npx playwright install chromium --with-deps
# RUN npx playwright install firefox

# Copy app source - copy all backend directories
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "api/server.js"]
