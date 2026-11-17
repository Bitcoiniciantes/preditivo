"use client";
// R6 — STATUS DA COLETA (bloco operacional, só apresentação).
// Lê public/r6-status.json gerado por scripts/r6-status.mjs (SQLite readOnly,
// SÓ contagens — nenhum teste estatístico). Não calcula nada, não executa o R6,
// não exibe probabilidades, não toca no PREDICTIVE_GATE.
// Refresh de baixa frequência (60s) sobre arquivo estático — sem polling agressivo.
import { useEffect, useState } from "react";

const REFRESH_MS = 60_000;
const REQUIRED_N = 120;
const REQUIRED_PER_CLASS = 30;
const HORIZONS = ["5m", "15m", "30m"] as const;

type HorizonStatus = {
  n: number;
  required: number;
  classes: { UP: number; RANGE: number; DOWN: number };
  remaining: { n: number; UP: number; RANGE: number; DOWN: number };
  met: boolean;
};

type R6Status = {
  updatedAt: string;
  ready: boolean;
  horizons: Record<string, HorizonStatus>;
};

function basePrefix(): string {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/preditivo")) return "/preditivo";
  return "";
}

export function R6StatusBlock() {
  const [st, setSt] = useState<R6Status | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`${basePrefix()}/r6-status.json`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as R6Status;
        if (active) setSt(body);
      } catch {
        /* monitor ainda não gerou o status — mantém "—" */
      }
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  const row = (label: string, have: number, need: number) => (
    <div className="obsState" key={label}>
      <span>{label}</span>
      <b>
        {have} / {need} {mark(have >= need)}
      </b>
    </div>
  );

  const h30 = st?.horizons["30m"] ?? null;
  const faltam: { label: string; value: string }[] = [];
  if (st && !st.ready) {
    for (const h of HORIZONS) {
      const hz = st.horizons[h];
      if (!hz) continue;
      if (hz.remaining.n > 0) faltam.push({ label: `${h} total`, value: `+${hz.remaining.n}` });
      for (const c of ["UP", "RANGE", "DOWN"] as const) {
        if (hz.remaining[c] > 0) faltam.push({ label: `${h} ${c}`, value: `+${hz.remaining[c]}` });
      }
    }
  }

  return (
    <div className="obsCell">
      <span className="obsLabel">R6 — STATUS DA COLETA</span>
      {st ? (
        <>
          {HORIZONS.map((h) => {
            const hz = st.horizons[h];
            return hz ? row(h, hz.n, hz.required ?? REQUIRED_N) : null;
          })}
          {h30 && (h30.remaining.UP > 0 || h30.remaining.RANGE > 0 || h30.remaining.DOWN > 0 || !h30.met) && (
            <>
              <span className="obsLabel">Classes 30m</span>
              {row("UP", h30.classes.UP, REQUIRED_PER_CLASS)}
              {row("RANGE", h30.classes.RANGE, REQUIRED_PER_CLASS)}
              {row("DOWN", h30.classes.DOWN, REQUIRED_PER_CLASS)}
            </>
          )}
          <span className="obsLabel">STATUS</span>
          <span className="obsValue">{st.ready ? "PRONTO PARA EXECUÇÃO" : "AGUARDANDO COLETA"}</span>
          {!st.ready && faltam.length > 0 && (
            <>
              <span className="obsLabel">FALTAM PARA O GATE</span>
              {faltam.map((f) => (
                <div className="obsState" key={f.label}>
                  <span>{f.label}</span>
                  <b>{f.value}</b>
                </div>
              ))}
            </>
          )}
          {st.ready && (
            <span className="obsHint">Gate atingido — execução estatística manual e única (não executada por este monitor).</span>
          )}
        </>
      ) : (
        <span className="obsHint">monitor ainda não gerou status…</span>
      )}
    </div>
  );
}
