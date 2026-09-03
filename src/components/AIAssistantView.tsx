import React, { useState } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  Zap,
  RefreshCw,
  User,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Copy,
  Check,
} from 'lucide-react';
import { Shipment, ShipmentAlert } from '../types';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

interface AIAssistantViewProps {
  shipments: Shipment[];
  alerts: ShipmentAlert[];
}

export const AIAssistantView: React.FC<AIAssistantViewProps> = ({ shipments, alerts }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg-welcome',
      sender: 'assistant',
      text: `Bonjour ! Je suis **Shipment AI**, votre assistant virtuel expert en Supply Chain et automatisation de transport.

Je peux analyser vos expéditions aériennes et maritimes, diagnostiquer les retards, détecter les anomalies (comme les colis bloqués à Orly > 10j ou les blocages douane) et rédiger vos messages de relance pour Google Chat.

**Suggestions de questions :**
- *"Fais une analyse globale des anomalies actives"*
- *"Combien de colis sont bloqués à Orly depuis plus de 10 jours ?"*
- *"Rédige une relance Google Chat pour l'expédition Dell (PO-2026-8812)"*
- *"Quels sont les fournisseurs ayant des retards récurrents ?"*`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  const quickPrompts = [
    'Analyse les colis bloqués à Orly > 10 jours',
    'Synthèse des blocages douaniers actifs',
    'Génère une relance Google Chat pour les retards critiques',
    'Compare la performance SLA de DHL, FedEx et UPS',
  ];

  const handleSendMessage = async (promptToSend?: string) => {
    const text = promptToSend || inputPrompt;
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!promptToSend) setInputPrompt('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          shipmentContext: {
            total_shipments: shipments.length,
            active_alerts: alerts,
            sample_shipments: shipments.slice(0, 15),
          },
        }),
      });

      const data = await response.json();

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        sender: 'assistant',
        text: data.reply || data.error || 'Aucune réponse obtenue.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: 'Erreur lors du traitement avec Shipment AI. Veuillez vérifier la connexion au serveur.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleRunExecutiveAudit = async () => {
    if (loading) return;
    setLoading(true);

    const auditUserMsg: Message = {
      id: `usr-audit-${Date.now()}`,
      sender: 'user',
      text: '⚡ [Aura-Audit] Générer un Rapport Exécutif Complet de la Supply Chain',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, auditUserMsg]);

    try {
      const res = await fetch('/api/analyze-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipments }),
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-audit-${Date.now()}`,
          sender: 'assistant',
          text: data.analysis || 'Erreur lors de la génération de l\'analyse exécutive.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyText = (msgId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(msgId);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="flex h-[82vh] flex-col rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-[#643288] to-[#A91869] p-4 text-white dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-extrabold flex items-center gap-2">
              Shipment AI Assistant <Sparkles className="h-4 w-4 text-amber-300" />
            </h2>
            <p className="text-xs text-purple-100">
              Moteur conversationnel fondé sur Gemini 3.6 Flash
            </p>
          </div>
        </div>

        <button
          onClick={handleRunExecutiveAudit}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl bg-white/20 px-3.5 py-2 text-xs font-bold text-white backdrop-blur transition hover:bg-white/30 disabled:opacity-50"
        >
          <Zap className="h-4 w-4 text-amber-300" /> Audit Exécutif IA
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3 ${
              msg.sender === 'user' ? 'flex-row-reverse' : ''
            }`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white text-xs font-bold ${
                msg.sender === 'user'
                  ? 'bg-slate-800 dark:bg-slate-700'
                  : 'bg-[#643288] shadow-md'
              }`}
            >
              {msg.sender === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>

            <div
              className={`relative max-w-2xl rounded-2xl p-4 text-xs shadow-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-[#643288] text-white rounded-tr-none'
                  : 'bg-slate-100 text-slate-800 rounded-tl-none dark:bg-slate-800 dark:text-slate-100'
              }`}
            >
              <div className="whitespace-pre-wrap font-sans">{msg.text}</div>

              <div className="mt-2 flex items-center justify-between border-t border-black/5 dark:border-white/5 pt-1.5 text-[10px] opacity-70">
                <span>{msg.timestamp}</span>
                {msg.sender === 'assistant' && (
                  <button
                    onClick={() => handleCopyText(msg.id, msg.text)}
                    className="flex items-center gap-1 text-[10px] font-semibold hover:underline"
                  >
                    {copiedIndex === msg.id ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" /> Copié
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copier
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#643288] text-white">
              <Bot className="h-4 w-4 animate-spin" />
            </div>
            <div className="rounded-2xl bg-slate-100 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Shipment AI analyse le dataset d'expéditions...
            </div>
          </div>
        )}
      </div>

      {/* Quick Prompts Chips */}
      <div className="border-t border-slate-100 bg-slate-50/50 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {quickPrompts.map((qp, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(qp)}
              disabled={loading}
              className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-2xs hover:border-[#643288] hover:text-[#643288] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-pink-400"
            >
              ⚡ {qp}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Input Field */}
      <div className="border-t border-slate-100 p-4 dark:border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            placeholder="Posez votre question à Shipment AI (ex: 'Rédige la relance pour DHL-8472910384')..."
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            disabled={loading}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-[#643288] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={loading || !inputPrompt.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-[#643288] px-4 py-2.5 text-xs font-bold text-white shadow transition hover:bg-[#522870] disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> Envoyer
          </button>
        </form>
      </div>
    </div>
  );
};
