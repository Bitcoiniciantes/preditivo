"use client";
// Rota do Indicador Único (Fase 1A) — /indicador-unico.
// Usa o MarketStreamProvider existente (o mesmo WebSocket único); nada de novo.
import Link from "next/link";
import { MarketStreamProvider } from "../MarketStreamProvider";
import { IndicadorUnico } from "../IndicadorUnico";

export default function IndicadorUnicoPage() {
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
        <section className="analysisDesk workspace" id="indicador-unico-pagina">
          <div className="analysisColumn analysisLeft">
            <div className="workspaceMain">
              <IndicadorUnico />
            </div>
          </div>
        </section>
        <footer>
          <span><b>T°</b> TERMÔMETRO PREDITIVO INVESTIDOR ARROJADO</span>
          <p>Motor determinístico · Leitura operacional consolidada</p>
        </footer>
      </main>
    </MarketStreamProvider>
  );
}
