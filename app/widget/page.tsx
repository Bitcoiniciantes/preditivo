import { Termometro } from "../page";

export const metadata = {
  title: "Radar Compra x Venda | Termometro Preditivo Avancado",
  description: "Widget do Termometro Preditivo Avancado.",
};

export default function WidgetPage(){
  return <div className="widgetEmbed"><Termometro/></div>;
}