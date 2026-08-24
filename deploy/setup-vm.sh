#!/bin/bash
# ============================================
# Setup da VM GCP e2-micro para o Preditivo
# Execute como root ou com sudo
# ============================================

set -e

echo "=== Atualizando sistema ==="
apt-get update && apt-get upgrade -y

echo "=== Instalando dependências ==="
apt-get install -y curl git nginx certbot python3-certbot-nginx

echo "=== Instalando Node.js 22 LTS ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "=== Verificando versões ==="
node --version
npm --version

echo "=== Instalando PM2 globalmente ==="
npm install -g pm2

echo "=== Configurando PM2 para iniciar com o sistema ==="
pm2 startup systemd -u $USER --hp /home/$USER
pm2 save

echo "=== Criando diretório do aplicativo ==="
mkdir -p /var/www/preditivo
chown $USER:$USER /var/www/preditivo

echo "=== Configurando firewall ==="
ufw allow 'Nginx Full'
ufw allow 22/tcp
ufw --force enable

echo "=== Setup concluído! ==="
echo "Proximo passo: clone o repositorio e execute o deploy"
