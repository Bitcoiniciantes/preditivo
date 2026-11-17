"use client";
// Rota do Definitivo como visão Complementar/histórica — /definitivo.
// Usa o MarketStreamProvider existente (o mesmo WebSocket único); nada de novo.
import Link from "next/link";
import { MarketStreamProvider } from "../MarketStreamProvider";
import { PainelDefinitivo } from "../PainelDefinitivo";

export default function DefinitivoPage() {
  return (
    <MarketStreamProvider>
      <main>
        <header>
          <Link className="brand" href="/" aria-label="Voltar aos painéis" title="Voltar aos painéis">
            <b>T°</b>
            <span>TERMÔMETRO PREDITIVO<small>INVESTIDOR ARROJADO</small></span>
          </Link>
          <nav aria-label="Menu principal">
            <Link href="/">Painéis</Link>
          </nav>
        </header>
        <section className="analysisDesk workspace" id="definitivo-pagina">
          <div className="analysisColumn analysisLeft">
            <div className="workspaceMain">
              <p className="obsHint">Visão complementar / histórico — a interface principal é o Super Painel Unificado.</p>
              <PainelDefinitivo />
            </div>
          </div>
        </section>
        <footer>
          <span><b>T°</b> TERMÔMETRO PREDITIVO INVESTIDOR ARROJADO</span>
          <p>Motor determinístico · Visão complementar</p>
        </footer>
      </main>
    </MarketStreamProvider>
  );
}
