FROM php:8.3-cli

WORKDIR /app

# Install system dependencies and PHP extensions
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    unzip \
    wget \
    libzip-dev \
    libxml2-dev \
    libcurl4-openssl-dev \
    libicu-dev \
    && docker-php-ext-install \
    zip \
    dom \
    curl \
    intl \
    && rm -rf /var/lib/apt/lists/*

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Copy composer files and install dependencies
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-interaction

# Copy source code
COPY . .

# Create non-root user and give it ownership of /app so the app can write
# webhook-log.json (the webhook event store) at runtime.
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

EXPOSE 8000

# router.php is the front controller — without it `/access-token` etc. won't route
CMD ["php", "-S", "0.0.0.0:8000", "router.php"]