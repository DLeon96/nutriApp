#!/bin/bash
# Script de configuración para Ubuntu 22.04 (Oracle Cloud ARM)
# Ejecutar con: bash setup-vps.sh

set -e

echo "=== Actualizando sistema ==="
sudo apt update && sudo apt upgrade -y

echo "=== Instalando dependencias de compilación (necesarias para better-sqlite3) ==="
sudo apt install -y build-essential python3 git curl

echo "=== Instalando Node.js 20 LTS ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "=== Instalando PM2 (gestor de procesos) ==="
sudo npm install -g pm2

echo "=== Clonando/copiando proyecto ==="
# Si usas git:
# git clone https://github.com/TU_USUARIO/nutribot.git
# cd nutribot
# Si subes por scp, solo cd nutribot

echo ""
echo "=== SIGUIENTES PASOS MANUALES ==="
echo "1. cd nutribot"
echo "2. npm install"
echo "3. cp .env.example .env && nano .env   (pegar tu GEMINI_API_KEY)"
echo "4. npm start                            (escanear QR con WhatsApp)"
echo "5. Ctrl+C después de vincular"
echo "6. pm2 start src/index.js --name nutribot"
echo "7. pm2 save && pm2 startup             (auto-inicio en reinicio)"
echo ""
echo "Para ver logs: pm2 logs nutribot"
echo "Para reiniciar: pm2 restart nutribot"
