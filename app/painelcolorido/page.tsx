"use client";
// Rota do Painel Colorido — /painelcolorido (experimental, diferenciação visual).
// Usa o MarketStreamProvider existente (o mesmo WebSocket único); nada de novo.
import Link from "next/link";
import { MarketStreamProvider } from "../MarketStreamProvider";
import { PainelColorido } from "./PainelColorido";
import "./painelcolorido.css";

export default function PainelColoridoPage() {
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
        <section id="painelcolorido-pagina">
          <PainelColorido />
        </section>
        <footer>
          <span><b>T°</b> PAINEL COLORIDO (EXPERIMENTAL)</span>
          <p>Leitura observacional · Sem interpretação preditiva</p>
        </footer>
      </main>
    </MarketStreamProvider>
  );
}
