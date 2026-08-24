#!/bin/bash
# ============================================
# Deploy do Preditivo para a VM
# Execute no diretório do repositório
# ============================================

set -e

APP_DIR="/var/www/preditivo"
REPO_URL="https://SEU_USUARIO_GITHUB/preditivo.git"  # ALTERE AQUI

echo "=== Clonando/atualizando repositório ==="
if [ -d "$APP_DIR/.git" ]; then
    cd $APP_DIR
    git pull origin main
else
    cd /var/www
    rm -rf preditivo
    git clone $REPO_URL preditivo
    cd preditivo
fi

echo "=== Copiando .env de produção ==="
if [ ! -f .env ]; then
    cp .env.example .env
    echo "ATENÇÃO: Edite o arquivo .env com suas chaves de API!"
    echo "  nano /var/www/preditivo/.env"
fi

echo "=== Instalando dependências ==="
npm ci

echo "=== Buildando o projeto ==="
npm run build

echo "=== Verificando se a pasta out/ existe ==="
if [ ! -d "out" ]; then
    echo "ERRO: Pasta 'out/' não encontrada após o build!"
    exit 1
fi

echo "=== Configurando nginx ==="
sudo cp deploy/nginx.conf /etc/nginx/sites-available/preditivo
sudo ln -sf /etc/nginx/sites-available/preditivo /etc/nginx/sites-enabled/preditivo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "=== Deploy concluído com sucesso! ==="
echo "Acesse: http://$(curl -s ifconfig.me)"
