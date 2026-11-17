# BuyNest API: production image for Railway (or any Docker host).
#
# One image, three jobs, picked by CONTAINER_ROLE (see docker/start.sh):
#   web        nginx + PHP-FPM on $PORT (runs migrations and caches first)
#   worker     php artisan queue:work (emails, newsletter batches)
#   scheduler  php artisan schedule:work (cron jobs every minute)
#
# Build:  docker build -t buynest-api backend
# Guide:  docs/DEPLOY_RAILWAY.md

# PHP 8.4 or later: composer.lock needs >= 8.4.1. "fpm" = PHP-FPM, the
# process manager nginx talks to. trixie = Debian 13.
FROM php:8.4-fpm-trixie

# --- System packages and PHP extensions --------------------------------------
# nginx: the web server. gosu: drops from root to www-data after fixing the
# volume's permissions (see docker/start.sh).
# Extensions the app needs beyond the base image: pdo_mysql (MySQL), bcmath,
# intl, zip, exif, pcntl (graceful stop for queue:work), opcache (speed).
# The -dev packages are only needed to compile; they are removed afterwards
# while the libraries the extensions link against are kept (the same trick
# the official PHP images use).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates gosu nginx unzip; \
    savedAptMark="$(apt-mark showmanual)"; \
    apt-get install -y --no-install-recommends libicu-dev libzip-dev; \
    docker-php-ext-install -j"$(nproc)" bcmath exif intl opcache pcntl pdo_mysql zip; \
    apt-mark auto '.*' > /dev/null; \
    apt-mark manual $savedAptMark > /dev/null; \
    find /usr/local -type f -executable -exec ldd '{}' ';' 2>/dev/null \
        | awk '/=>/ { so = $(NF-1); if (index(so, "/usr/local/") == 1) { next }; gsub("^/(usr/)?", "", so); print so }' \
        | sort -u | xargs -r dpkg-query --search | cut -d: -f1 | sort -u | xargs -r apt-mark manual; \
    apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
    rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled /etc/nginx/conf.d; \
    php -m | grep -qi pdo_mysql

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# --- PHP, PHP-FPM and nginx settings -----------------------------------------
RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"
COPY docker/php/buynest.ini "$PHP_INI_DIR/conf.d/zz-buynest.ini"
COPY docker/php/fpm-pool.conf /usr/local/etc/php-fpm.d/zzz-buynest.conf
COPY docker/nginx/nginx.conf.template /etc/nginx/buynest.conf.template
COPY docker/start.sh /usr/local/bin/start
COPY docker/artisan.sh /usr/local/bin/artisan
RUN chmod 0755 /usr/local/bin/start /usr/local/bin/artisan

ENV APP_ENV=production \
    APP_DEBUG=false \
    LOG_CHANNEL=stderr \
    PORT=8080 \
    PHP_FPM_MAX_CHILDREN=10 \
    COMPOSER_ALLOW_SUPERUSER=1 \
    COMPOSER_NO_INTERACTION=1

WORKDIR /var/www/html

# --- PHP packages (cached until composer.json / composer.lock change) ---------
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --no-progress

# --- The app ------------------------------------------------------------------
# Code stays owned by root (the web server can read it but not change it);
# only storage/ and bootstrap/cache/ are writable by www-data.
COPY . .
RUN set -eux; \
    composer install --no-dev --optimize-autoloader --no-interaction --no-progress; \
    composer clear-cache; \
    rm -f public/storage; \
    mkdir -p storage/app/public storage/app/private storage/framework/cache/data \
        storage/framework/sessions storage/framework/views storage/logs bootstrap/cache; \
    chown -R www-data:www-data storage bootstrap/cache

# The base image stops PHP-FPM with SIGQUIT; start.sh expects SIGTERM.
STOPSIGNAL SIGTERM
EXPOSE 8080

# The base image's entrypoint runs this command as given. The container starts
# as root only so start.sh can fix the Railway volume's owner; it then
# switches to www-data before running anything else.
CMD ["start"]
