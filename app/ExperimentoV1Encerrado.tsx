"use client";
// EXPERIMENTO V1 — ENCERRADO. Seção isolada, fora da hierarquia principal de
// leitura. Card resumido: o detalhe técnico completo vive na documentação
// (FASE1_EXPERIMENTO_MINIMO.md, DECISOES.md, FASE1_AMOSTRA_DIAGNOSTICO.md) e
// NÃO é duplicado aqui — sem N/OOS/gates/R6 na UI.
export function ExperimentoV1Encerrado() {
  return (
    <section id="experimento-v1-encerrado" aria-label="Experimento V1 — Encerrado">
      <div className="cardTitle">
        <div>
          <span>EXPERIMENTO ENCERRADO</span>
          <b>Experimento V1 — Encerrado</b>
        </div>
      </div>
      <div className="obsCell">
        <span className="obsLabel">HIPÓTESE TESTADA</span>
        <p className="obsHint">Cinco features combinadas por regressão logística para prever o target de 15 minutos, contra a baseline de persistência.</p>
        <span className="obsLabel">RESULTADO</span>
        <p className="obsHint">Hipótese não sustentada nos horizontes testados: em 30 minutos não houve evidência; nos demais, evidência preliminar insuficiente para liberar o gate.</p>
        <div className="obsState"><span>Status</span><b>Funcionalidade preditiva desativada</b></div>
        <span className="obsHint">Detalhe técnico completo em FASE1_EXPERIMENTO_MINIMO.md, DECISOES.md e FASE1_AMOSTRA_DIAGNOSTICO.md no repositório.</span>
      </div>
    </section>
  );
}
