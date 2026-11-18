#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. Удаление устаревших и конфликтующих пакетов ==="
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    sudo apt-get remove -y "$pkg" 2>/dev/null || true
done

echo "=== 2. Установка зависимостей ==="
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

echo "=== 3. Добавление официального GPG-ключа Docker ==="
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "=== 4. Подключение официального репозитория Docker ==="
UBUNTU_CODENAME="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  ${UBUNTU_CODENAME} stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

echo "=== 5. Установка Docker Engine и CLI ==="
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "=== 6. Настройка прав пользователя ==="
sudo usermod -aG docker "$USER"

echo "=== 7. Включение и запуск службы Docker ==="
if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
    sudo systemctl enable --now docker
else
    sudo service docker start
fi

echo "=== Установка завершена! ==="
echo "Чтобы команды docker работали без sudo в текущей сессии, выполните: newgrp docker"