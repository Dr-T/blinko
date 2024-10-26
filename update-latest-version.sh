#!/bin/bash

echo "Pull up the latest blinko mirror image..."

docker compose -f docker-compose.prod.yml pull blinko-website

DB_STATUS=$(docker compose -f docker-compose.prod.yml ps postgres | grep "Up")

if [ -z "$DB_STATUS" ]; then
    echo "The database container is not running or exists and is starting a new database container..."

    # 检查是否存在名为 blinko-postgres 的容器
    if [ "$(docker ps -aq -f name=blinko-postgres)" ]; then
        echo "A container with the name 'blinko-postgres' already exists. Removing it..."
        docker rm -f blinko-postgres
    fi

    docker compose -f docker-compose.prod.yml up -d postgres
else
    echo "The database container is running, keeping the database container..."
fi

echo "Delete the existing website container..."
if [ "$(docker ps -aq -f name=blinko-website)" ]; then
    docker rm -f blinko-website
else
    echo "blinko-website container does not exist."
fi

echo "Start the new website container..."
docker compose -f docker-compose.prod.yml up -d blinko-website