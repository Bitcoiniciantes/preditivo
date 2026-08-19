import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import "./nexus.css";

const geistSans=Geist({variable:"--font-geist-sans",subsets:["latin"]});
const geistMono=Geist_Mono({variable:"--font-geist-mono",subsets:["latin"]});

export const metadata:Metadata={
 title:"Term\u00f4metro Preditivo Avan\u00e7ado",
 description:"Leitura preditiva avancada de mercado com confluencia, RSI e fluxo.",
 icons:{icon:"./icon.svg"}
};

export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="pt-BR"><body className={`${geistSans.variable} ${geistMono.variable}`}>
  {children}
  <Script id="worker-counter" strategy="afterInteractive">{`
   (() => {
    var WORKER_URL = 'https://floral-truth-af64.bitcoiniciantes.workers.dev';
    var SITE_NAME = 'preditivo';
    var el = document.querySelector('[data-goatcounter-total]');
    var today = new Date().toISOString().slice(0, 10);
    var lastVisit = localStorage.getItem('btc_last_visit_' + SITE_NAME);
    
    if (lastVisit === today) {
     fetch(WORKER_URL + '/total?site=' + SITE_NAME)
      .then(r => r.json())
      .then(data => {
       if (el && data.count !== undefined) el.textContent = ' · ' + data.count.toLocaleString('pt-BR') + (data.count === 1 ? ' acesso' : ' acessos');
      })
      .catch(() => {});
    } else {
     localStorage.setItem('btc_last_visit_' + SITE_NAME, today);
     fetch(WORKER_URL + '/count?site=' + SITE_NAME)
      .then(r => r.json())
      .then(data => {
       if (el && data.count !== undefined) el.textContent = ' · ' + data.count.toLocaleString('pt-BR') + (data.count === 1 ? ' acesso' : ' acessos');
      })
      .catch(() => {
       fetch(WORKER_URL + '/total?site=' + SITE_NAME)
        .then(r => r.json())
        .then(data => {
         if (el && data.count !== undefined) el.textContent = ' · ' + data.count.toLocaleString('pt-BR') + (data.count === 1 ? ' acesso' : ' acessos');
        })
        .catch(() => {});
      });
    }
   })();
  `}</Script>
 </body></html>;
}
