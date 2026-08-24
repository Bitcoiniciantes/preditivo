# Guia Definitivo: Alertas de Suporte e Resistência

Este documento contém a implementação final com todas as correções de arquitetura aplicadas, focando em estabilidade de hardware e consistência de estado no React.

## O que foi corrigido:
1. **Memory Leak e Limite de Hardware (AudioContext):** O contexto de áudio agora é fechado no evento `onended` do oscilador.
2. **Falha Silenciosa no Safari/Chrome:** A função `playBeep` agora é `async` e aplica `await audioCtx.resume()` antes de tentar disparar o som.
3. **Stale Closures no React:** O rastreio do `cooldown` foi transferido de uma dependência de estado (`alert`) para um `useRef` (`lastAlertRef`), impedindo falhas caso o componente pare de re-renderizar entre cruzamentos.

---

## 1. O Hook (`useSupportResistanceAlert.ts`)

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';

type AlertType = 'SUPPORT' | 'RESISTANCE';

interface AlertState {
  type: AlertType;
  price: number;
  timestamp: number;
  isVisible: boolean;
}

const playBeep = async () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass();
    
    // Aguarda a liberação do contexto caso esteja suspenso pelo navegador
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

    // CRÍTICO: Evita vazamento de memória e exaustão do limite de AudioContext do navegador
    oscillator.onended = () => {
      audioCtx.close();
    };

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.5);
  } catch (error) {
    console.error("Erro ao tocar alerta de áudio (Autoplay block provável):", error);
  }
};

export function useSupportResistanceAlert({
  currentPrice,
  support,
  resistance,
  enabled = false,
  tolerancePercent = 0.1,
  cooldownMs = 300000 // 5 minutos
}: {
  currentPrice: number;
  support: number;
  resistance: number;
  enabled?: boolean;
  tolerancePercent?: number;
  cooldownMs?: number;
}) {
  const [alert, setAlert] = useState<AlertState | null>(null);
  
  // CRÍTICO: Refs para manter valores atualizados fora do ciclo de dependências do useEffect
  const previousPriceRef = useRef<number>(currentPrice);
  const lastAlertRef = useRef<{ type: AlertType; timestamp: number } | null>(null);

  const dismissAlert = useCallback(() => {
    setAlert(prev => prev ? { ...prev, isVisible: false } : null);
  }, []);

  useEffect(() => {
    if (!enabled || !currentPrice || !support || !resistance) {
      previousPriceRef.current = currentPrice;
      return;
    }

    const previousPrice = previousPriceRef.current;
    const tolerance = tolerancePercent / 100;
    
    const supportThreshold = support * (1 + tolerance);
    const resistanceThreshold = resistance * (1 - tolerance);
    const now = Date.now();

    const isCoolingDown = (type: AlertType) => {
      // Uso do useRef evita problemas de stale closure
      const last = lastAlertRef.current;
      return last && last.type === type && (now - last.timestamp < cooldownMs);
    };

    // Detecção: Cruzamento de Suporte
    if (previousPrice > supportThreshold && currentPrice <= supportThreshold && !isCoolingDown('SUPPORT')) {
      setAlert({ type: 'SUPPORT', price: currentPrice, timestamp: now, isVisible: true });
      lastAlertRef.current = { type: 'SUPPORT', timestamp: now };
      playBeep();
    }
    // Detecção: Cruzamento de Resistência
    else if (previousPrice < resistanceThreshold && currentPrice >= resistanceThreshold && !isCoolingDown('RESISTANCE')) {
      setAlert({ type: 'RESISTANCE', price: currentPrice, timestamp: now, isVisible: true });
      lastAlertRef.current = { type: 'RESISTANCE', timestamp: now };
      playBeep();
    }

    previousPriceRef.current = currentPrice;
  }, [currentPrice, support, resistance, enabled, tolerancePercent, cooldownMs]);

  return { alert, dismissAlert };
}
```

## 2. Componente Visual (`SupportResistanceAlert.tsx`)

```tsx
import { useEffect } from 'react';

export function SupportResistanceAlert({ 
  alert, 
  asset, 
  currency,
  onDismiss 
}: {
  alert: { type: 'SUPPORT' | 'RESISTANCE'; price: number; timestamp: number; isVisible: boolean } | null;
  asset: string;
  currency: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!alert?.isVisible) return;
    
    // Auto-dismiss após 10 segundos
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [alert?.timestamp, alert?.isVisible, onDismiss]);
  
  if (!alert?.isVisible) return null;
  
  const isSupport = alert.type === 'SUPPORT';
  
  return (
    <div 
      className={`priceAlert ${isSupport ? 'supportAlert' : 'resistanceAlert'}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="priceAlertIcon">
        {isSupport ? '⬇️' : '⬆️'}
      </div>
      <div className="priceAlertContent">
        <strong>{isSupport ? 'SUPORTE ATINGIDO' : 'RESISTÊNCIA ATINGIDA'}</strong>
        <span>{asset}</span>
        <span className="priceAlertPrice">
          {currency} {alert.price.toLocaleString('pt-BR', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
          })}
        </span>
      </div>
      <button 
        className="priceAlertClose" 
        onClick={onDismiss}
        aria-label="Fechar alerta"
      >
        ×
      </button>
    </div>
  );
}
```

## 3. Integração no Gráfico (`PriceStructureChart.tsx`)

```tsx
import { useState } from 'react';
import { useSupportResistanceAlert } from './useSupportResistanceAlert';
import { SupportResistanceAlert } from './SupportResistanceAlert';

export default function PriceStructureChart({ 
  asset, 
  candles, 
  currentPrice, 
  currency, 
  loading, 
  resistance, 
  support 
}: Props) {
  
  // Estado para opt-in de áudio (OBRIGATÓRIO)
  const [alertsEnabled, setAlertsEnabled] = useState(false);

  const { alert, dismissAlert } = useSupportResistanceAlert({
    currentPrice,
    support,
    resistance,
    enabled: alertsEnabled && !loading && currentPrice > 0,
    tolerancePercent: 0.1,
  });

  return (
    <>
      {/* Controle de Opt-in */}
      <div className="chartHeaderControls">
        <button 
          onClick={() => setAlertsEnabled(!alertsEnabled)}
          className={`alertToggleBtn ${alertsEnabled ? 'active' : ''}`}
        >
          {alertsEnabled ? '🔔 Alertas Ativos' : '🔕 Ativar Alertas'}
        </button>
      </div>

      <SupportResistanceAlert
        alert={alert}
        asset={asset}
        currency={currency}
        onDismiss={dismissAlert}
      />
      
      <div className="priceChart realPriceChart">
        {/* ... */}
      </div>
    </>
  );
}
```

## 4. Estilização (`globals.css`)

```css
.priceAlert {
  position: fixed;
  top: 80px;
  right: 20px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 8px;
  background: white;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  animation: slideInRight 0.3s ease-out, pulse 0.5s ease-in-out 3;
  border-left: 4px solid;
}

.supportAlert {
  border-left-color: #54b85a;
}

.resistanceAlert {
  border-left-color: #e2555d;
}

.priceAlertIcon {
  font-size: 32px;
  line-height: 1;
}

.priceAlertContent {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.priceAlertContent strong {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.priceAlertContent span {
  font-size: 12px;
  color: #718079;
}

.priceAlertPrice {
  font-size: 18px !important;
  font-weight: 700 !important;
  color: #1a1d21 !important;
}

.priceAlertClose {
  margin-left: auto;
  background: transparent;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #718079;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.priceAlertClose:hover {
  color: #1a1d21;
}

.alertToggleBtn {
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid #ccc;
  background: #f5f5f5;
  cursor: pointer;
}
.alertToggleBtn.active {
  background: #e3f2fd;
  border-color: #2196f3;
  color: #0d47a1;
}

@keyframes slideInRight {
  from { transform: translateX(400px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.02); }
}

@media (max-width: 768px) {
  .priceAlert {
    top: auto;
    bottom: 20px;
    right: 10px;
    left: 10px;
    max-width: calc(100vw - 20px);
  }
}
```
