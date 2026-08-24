"use client";
import { useState, useEffect } from "react";

interface StructuralAlertProps {
  absorptionState: 'NONE' | 'BULL_ABSORPTION' | 'BEAR_ABSORPTION';
  absorptionLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  absorptionIntensity: number;
  regime: 'BULL_TREND' | 'BEAR_TREND' | 'RANGE';
  confidence: number;
  divergence: 'DIVERGENCE_BULL' | 'DIVERGENCE_BEAR' | 'NONE';
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function getAbsorptionColor(level: StructuralAlertProps['absorptionLevel']): string {
  switch (level) {
    case 'HIGH': return 'var(--red)';
    case 'MEDIUM': return '#f0ad4e';
    case 'LOW': return 'var(--muted)';
  }
}

function getAbsorptionLabel(state: StructuralAlertProps['absorptionState']): string {
  switch (state) {
    case 'BULL_ABSORPTION': return 'ABSORÇÃO COMPRA';
    case 'BEAR_ABSORPTION': return 'ABSORÇÃO VENDA';
    case 'NONE': return 'SEM ABSORÇÃO';
  }
}

function getRegimeLabel(regime: StructuralAlertProps['regime']): string {
  switch (regime) {
    case 'BULL_TREND': return 'TENDENCIA ALTA';
    case 'BEAR_TREND': return 'TENDENCIA BAIXA';
    case 'RANGE': return 'LATERAL';
  }
}

function getRegimeColor(regime: StructuralAlertProps['regime']): string {
  switch (regime) {
    case 'BULL_TREND': return 'var(--lime)';
    case 'BEAR_TREND': return 'var(--red)';
    case 'RANGE': return 'var(--muted)';
  }
}

function getDivergenceLabel(divergence: StructuralAlertProps['divergence']): string {
  switch (divergence) {
    case 'DIVERGENCE_BULL': return 'FLUXO ANTECEDE PREÇO';
    case 'DIVERGENCE_BEAR': return 'FLUXO ANTECEDE PREÇO';
    case 'NONE': return '';
  }
}

function getDivergenceColor(divergence: StructuralAlertProps['divergence']): string {
  switch (divergence) {
    case 'DIVERGENCE_BULL': return 'var(--lime)';
    case 'DIVERGENCE_BEAR': return 'var(--red)';
    case 'NONE': return 'var(--muted)';
  }
}

export default function StructuralAlert({
  absorptionState,
  absorptionLevel,
  absorptionIntensity,
  regime,
  confidence,
  divergence,
}: StructuralAlertProps) {
  const debouncedRegime = useDebouncedValue(regime, 2500);
  const debouncedAbsorption = useDebouncedValue(absorptionState, 2500);
  const debouncedLevel = useDebouncedValue(absorptionLevel, 2500);
  const debouncedDivergence = useDebouncedValue(divergence, 2500);

  const showAlert = debouncedAbsorption !== 'NONE' || debouncedRegime !== 'RANGE' || debouncedDivergence !== 'NONE';
  const alertColor = debouncedDivergence !== 'NONE'
    ? getDivergenceColor(debouncedDivergence)
    : debouncedAbsorption !== 'NONE'
      ? getAbsorptionColor(debouncedLevel)
      : getRegimeColor(debouncedRegime);

  return (
    <div className={`structuralAlert ${showAlert ? 'structuralAlertActive' : ''}`} style={{ borderColor: showAlert ? alertColor : '#26312d' }}>
      <div className="structuralAlertHeader">
        <span className="structuralAlertTitle">ALERTA ESTRUTURAL</span>
        {confidence > 0 && (
          <span className="structuralAlertConf" style={{ color: confidence > 60 ? 'var(--lime)' : 'var(--muted)' }}>
            {confidence}%
          </span>
        )}
      </div>
      <div className="structuralAlertBody">
        <div className="structuralAlertItem">
          <span className="structuralAlertLabel">REGIME</span>
          <span className="structuralAlertValue" style={{ color: getRegimeColor(debouncedRegime) }}>
            {getRegimeLabel(debouncedRegime)}
          </span>
        </div>
        {debouncedDivergence !== 'NONE' && (
          <div className="structuralAlertItem structuralAlertDivergence">
            <span className="structuralAlertLabel">⚡ SINAL</span>
            <span className="structuralAlertValue" style={{ color: getDivergenceColor(debouncedDivergence) }}>
              {getDivergenceLabel(debouncedDivergence)}
            </span>
          </div>
        )}
        {debouncedAbsorption !== 'NONE' && (
          <div className="structuralAlertItem">
            <span className="structuralAlertLabel">ABSORÇÃO</span>
            <span className="structuralAlertValue" style={{ color: getAbsorptionColor(debouncedLevel) }}>
              {getAbsorptionLabel(debouncedAbsorption)} ({(absorptionIntensity * 100).toFixed(1)}%)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
