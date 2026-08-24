#!/bin/bash
# ============================================
# Deploy remoto via SSH
# Execute da máquina local
# ============================================

set -e

# CONFIGURAÇÕES - ALTERE AQUI
VM_IP="SEU_IP_DA_VM"        # Ex: 34.123.45.67
VM_USER="SEU_USER"           # Ex: joelh ou deploy
SSH_KEY="~/.ssh/id_rsa"      # Caminho da chave SSH

echo "=== Sincronizando código para a VM ==="
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'out' \
    --exclude '.git' \
    --exclude '*.log' \
    -e "ssh -i $SSH_KEY" \
    ./ ${VM_USER}@${VM_IP}:/var/www/preditivo/

echo "=== Executando build na VM ==="
ssh -i $SSH_KEY ${VM_USER}@${VM_IP} << 'EOF'
    cd /var/www/preditivo
    npm ci
    npm run build
    sudo cp deploy/nginx.conf /etc/nginx/sites-available/preditivo
    sudo nginx -t && sudo systemctl reload nginx
    echo "Deploy concluído!"
EOF

echo "=== Pronto! Acesse http://${VM_IP} ==="
