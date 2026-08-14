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
  <Script data-goatcounter="https://termometro.goatcounter.com/count" src="https://gc.zgo.at/count.js" strategy="afterInteractive" />
  <Script id="goatcounter-total" strategy="afterInteractive">{`
   (() => {
    const renderTotal = () => {
     const target = document.querySelector("[data-goatcounter-total]");
     if (!target) return;
     fetch("https://termometro.goatcounter.com/counter/TOTAL.json")
      .then(response => response.ok ? response.json() : null)
      .then(data => {
       if (!data?.count) return;
       target.textContent = " \u00b7 " + data.count + (data.count === "1" ? " Cerva" : " Cervas");
       target.hidden = false;
      })
      .catch(() => {});
    };
    window.setTimeout(renderTotal, 500);
   })();
  `}</Script>
 </body></html>;
}
