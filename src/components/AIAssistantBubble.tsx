import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  Zap,
  User,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { Shipment, ShipmentAlert } from '../types';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

interface AIAssistantBubbleProps {
  shipments: Shipment[];
  alerts: ShipmentAlert[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Floating chat available on every screen. The panel stays mounted while
 * closed so the conversation is kept when navigating.
 */
export const AIAssistantBubble: React.FC<AIAssistantBubbleProps> = ({ shipments, alerts, open, onOpenChange }) => {
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
        credentials: 'include',
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
        credentials: 'include',
        body: JSON.stringify({ shipments }),
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-audit-${Date.now()}`,
          sender: 'assistant',
          text: data.analysis || data.error || 'Erreur lors de la génération de l\'analyse exécutive.',
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

  // Keep the latest message in view
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  // Escape closes the panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <>
      {!open && (
        <button
          id="ai-bubble-toggle"
          type="button"
          onClick={() => onOpenChange(true)}
          title="Ouvrir Shipment AI"
          aria-label="Ouvrir l'assistant Shipment AI"
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#643288] to-[#A91869] text-white shadow-xl shadow-[#643288]/30 transition hover:scale-105 active:scale-95"
        >
          <Bot className="h-6 w-6" />
          {loading && <span className="absolute right-1 top-1 h-3 w-3 animate-pulse rounded-full bg-amber-300 ring-2 ring-white" />}
        </button>
      )}

      <div
        role="dialog"
        aria-label="Assistant Shipment AI"
        className={`fixed bottom-5 right-5 z-40 h-[min(620px,calc(100vh-6rem))] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 ${
          open ? 'flex' : 'hidden'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-[#643288] to-[#A91869] px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-extrabold">
                Shipment AI <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              </h2>
              <p className="text-[10px] text-purple-100">Assistant Supply Chain (Gemini)</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRunExecutiveAudit}
              disabled={loading}
              title="Générer un rapport exécutif complet"
              className="flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-white/30 disabled:opacity-50"
            >
              <Zap className="h-3.5 w-3.5 text-amber-300" /> Audit
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              title="Fermer (Échap)"
              aria-label="Fermer l'assistant"
              className="rounded-lg p-1.5 text-white/90 transition hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white ${
                  msg.sender === 'user' ? 'bg-slate-800 dark:bg-slate-700' : 'bg-[#643288]'
                }`}
              >
                {msg.sender === 'user' ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              </div>

              <div
                className={`relative max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                  msg.sender === 'user'
                    ? 'rounded-tr-none bg-[#643288] text-white'
                    : 'rounded-tl-none bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                <div className="whitespace-pre-wrap break-words font-sans">{msg.text}</div>

                <div className="mt-2 flex items-center justify-between border-t border-black/5 pt-1.5 text-[10px] opacity-70 dark:border-white/5">
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
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#643288] text-white">
                <Bot className="h-3.5 w-3.5 animate-spin" />
              </div>
              <div className="rounded-2xl bg-slate-100 p-2.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                Shipment AI analyse les expéditions...
              </div>
            </div>
          )}
        </div>

        {/* Quick prompts */}
        <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {quickPrompts.map((qp, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(qp)}
                disabled={loading}
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#643288] hover:text-[#643288] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-pink-400"
              >
                ⚡ {qp}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-slate-100 p-3 dark:border-slate-800">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="Posez votre question à Shipment AI…"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              disabled={loading}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-[#643288] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={loading || !inputPrompt.trim()}
              title="Envoyer"
              aria-label="Envoyer"
              className="flex items-center justify-center rounded-xl bg-[#643288] p-2.5 text-white shadow transition hover:bg-[#522870] disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
};
