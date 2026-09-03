import React, { useState } from 'react';
import {
  FileText,
  Play,
  Copy,
  Check,
  Code,
  Layers,
  Database,
  Workflow,
  Sparkles,
  ShieldCheck,
  Bot,
  Layout,
} from 'lucide-react';

export const DeliverablesView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<
    'script' | 'master' | 'tracking' | 'assistant' | 'uiux' | 'rules' | 'database' | 'n8n'
  >('script');

  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const demoScript = `🎬 SCRIPT DE DÉMONSTRATION D'APPLICATION (5 MINUTES)
Projet: Shipment Manager — Intelligence Artificielle & Automatisation Supply Chain

[0:00 - 0:45] INTRODUCTION & DÉMONSTRATION DU DASHBOARD
- "Bienvenue dans Shipment Manager, l'application métier centralisée conçue pour remplacer le Google Sheet traditionnel de suivi des expéditions."
- Présenter les KPIs clés en haut de page : 50 expéditions actives, répartition Air/Sea, et le Taux de Respect SLA Transporteurs (82%).
- Pointer du doigt le bandeau d'alerte rouge : "Comme vous le voyez, le système surveille en continu les règles métiers. L'IA a automatiquement détecté 3 colis en souffrance au hub d'Orly depuis plus de 10 jours."

[0:45 - 1:45] SUIVI AÉRIEN & RECHERCHE AVANCÉE
- Cliquer sur l'onglet 'Suivi Aérien'.
- Démonstration du filtre dynamique par transporteur (DHL, FedEx, UPS) et par statut global.
- Effectuer une recherche rapide sur une référence commande (ex: 'PO-2026-8812').
- Ouvrir la fiche détaillée : montrer la frise chronologique du transporteur, le statut 'Antoine/Transitaire' et les documents joints (Facture commerciale, LTA/BL).

[1:45 - 2:45] DÉTECTION DES ANOMALIES & RELANCE GOOGLE CHAT
- Naviguer vers le 'Centre d'Alertes'.
- Montrer la Règle #1 (Colis livré Orly > 10j sans départ vers Madagascar).
- Cliquer sur 'Générer Relance Google Chat' : le système a pré-rédigé un message professionnel formaté avec tous les détails (N° LTA, fournisseur, délai).
- Cliquer sur 'Envoyer au Chat' : le webhook simulé transmet l'alerte instantanément au canal Google Chat Supply Chain.

[2:45 - 3:45] DEMO ASSISTANT IA (SHIPMENT AI - GEMINI 3.6 FLASH)
- Ouvrir l'onglet 'Assistant IA'.
- Cliquer sur la question rapide : "Analyse les colis bloqués à Orly > 10 jours".
- L'assistant IA analyse le lot de données en temps réel et fournit un diagnostic précis.
- Poser une question libre : "Rédige une relance courtoise mais ferme pour le fournisseur Dell concernant la commande PO-2026-8812".
- Montrer la qualité et la réactivité de la réponse générée côté serveur par le SDK Gemini.

[3:45 - 4:30] ANALYTICS & MATRIX TRANSPORTIERS
- Aller sur l'onglet 'Analyses & SLAs'.
- Présenter le classement des transporteurs (Leaderboard SLA) et les temps moyens de transit par axe.
- Passer sur l'onglet 'Administration' pour montrer la matrice des 11 connecteurs API transporteurs (DHL, FedEx, UPS, MSC, Maersk) et le schéma de workflow N8N.

[4:30 - 5:00] CONCLUSION & PERSPECTIVES
- "En résumé, Shipment Manager modernise le pilotage Supply Chain en éliminant les erreurs manuelles du Google Sheet, en automatisant la détection des anomalies et en offrant un assistant IA Gemini directement intégré."
- "L'architecture full-stack Express + React est totalement prête pour une intégration directe avec Odoo, N8N et les API réelles des transporteurs."`;

  const masterPrompt = `Prompt Maître --- Shipment Manager
Tu es un Product Owner Senior, Architecte Logiciel Supply Chain, UX Designer et Expert Google AI Studio.

Mission:
Construire une application métier nommée Shipment Manager destinée à remplacer progressivement un Google Sheet de suivi des expéditions.

Objectifs:
- Centraliser le suivi aérien et maritime
- Utiliser Google Sheets comme base temporaire
- Intégrer un assistant IA
- Prévoir une architecture évolutive (API transporteurs, Odoo, N8N)
- Générer une application responsive

Utilisateurs:
- Supply Chain : édition
- Sourcing : lecture
- Direction : dashboard

Modules:
- Dashboard
- Suivi aérien
- Suivi maritime
- Détail expédition
- Alertes
- Analytics
- Assistant IA
- Administration`;

  const trackingPrompt = `Prompt Tracking:
Créer une couche Tracking compatible avec : DHL Express, FedEx, UPS, TNT, GLS, DPD, Chronopost, Colissimo, Amazon Logistics, DB Schenker, DACHSER, CEVA Logistics, MSC, Maersk.

Pour chaque transporteur récupérer :
- statut (In Transit, Delivered, Customs Clearance, Exception)
- dernière localisation
- dernière mise à jour
- ETA
- preuve de livraison si disponible

Architecture extensible pour futures API REST/DCSA.`;

  const assistantPrompt = `Prompt Assistant IA:
Tu es Shipment AI.
Tu analyses les expéditions.

Tu peux :
- détecter les retards
- expliquer les statuts
- proposer des actions
- générer les relances Google Chat
- calculer les KPI
- répondre aux questions métier

Ne jamais inventer une information absente. Toujours expliquer ton raisonnement.`;

  const rulesDoc = `Règles Métier Alimentant le Moteur d'Alertes:

1. Règle Hub Orly (>10j):
SI statut transporteur = Delivered (ou Livré Orly)
ET date départ Madagascar = vide
ET délai à Orly > 10 jours
ALORS Créer une Alerte Critique "Dépassement Délai Hub Orly"
ET Générer un brouillon de relance Google Chat pour le transitaire / Antoine.

2. Règle Confirmation Transitaire (>4j):
SI statut global = "Attente confirmation transitaire"
ET durée d'attente >= 4 jours
ALORS Créer une Alerte Avertissement "Relance confirmation transitaire requise".

3. Règle Blocage Douanier:
SI statut douane = "Bloqué Douane" OU statut global = "Bloqué Douane"
ALORS Créer une Alerte Critique "Anomalie Dédouanement"
ET Générer une relance demandant la facture commerciale certifiée et le H.S. Code.

4. Règle Dépassement ETA:
SI ETA < Date du jour ET statut transporteur != Delivered
ALORS Créer un Avertissement "Retard transporteur".`;

  const databaseDoc = `Modèle de Données (Typescript & Relationnel):

Entité Shipment (Expédition Principal):
- id: string (PK)
- mode: 'Air' | 'Sea'
- supplier: string
- order_reference: string
- invoice_no: string
- bl_awb: string (LTA ou Bill of Lading)
- tracking_no: string
- carrier: string
- carrier_status: string
- carrier_last_location: string
- eta: string
- actual_delivery?: string
- antoine_status: 'Confirmé' | 'En attente Antoine' | 'Transmis transitaire' | 'A vérifier'
- departure_madagascar?: string
- global_status: 'Expédié fournisseur' | 'En livraison vers Orly' | 'Livré Orly' | 'Attente confirmation transitaire' | 'Expédié Madagascar' | 'Livré Client/Entrepôt' | 'Bloqué Douane'
- remarks: text
- priority: 'Haute' | 'Moyenne' | 'Basse'
- weight_kg: number
- cost_eur: number
- customs_status: string

Entité Alert:
- id: string
- shipment_id: string (FK -> Shipment.id)
- severity: 'critical' | 'warning' | 'info'
- rule_code: string
- title: string
- reason: text
- relance_draft?: text

Entité Document:
- id: string
- shipment_id: string (FK -> Shipment.id)
- type: 'Invoice' | 'BL_AWB' | 'Customs'
- filename: string
- url: string`;

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
          <FileText className="h-6 w-6 text-[#643288]" /> Livrables Projets & Script de Démonstration (5 min)
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Documents de cadrage, promts maîtres, règles métier et script de soutenance orale
        </p>
      </div>

      {/* Tabs Switcher */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        <button
          onClick={() => setActiveSection('script')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            activeSection === 'script'
              ? 'bg-[#643288] text-white shadow'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          <Play className="h-3.5 w-3.5" /> Script Démo 5 Min
        </button>

        <button
          onClick={() => setActiveSection('master')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            activeSection === 'master'
              ? 'bg-[#643288] text-white shadow'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" /> Prompt Maître
        </button>

        <button
          onClick={() => setActiveSection('tracking')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            activeSection === 'tracking'
              ? 'bg-[#643288] text-white shadow'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          <Code className="h-3.5 w-3.5" /> Prompt Tracking Transporteurs
        </button>

        <button
          onClick={() => setActiveSection('assistant')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            activeSection === 'assistant'
              ? 'bg-[#643288] text-white shadow'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          <Bot className="h-3.5 w-3.5" /> Prompt Assistant IA
        </button>

        <button
          onClick={() => setActiveSection('rules')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            activeSection === 'rules'
              ? 'bg-[#643288] text-white shadow'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Règles Métier
        </button>

        <button
          onClick={() => setActiveSection('database')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            activeSection === 'database'
              ? 'bg-[#643288] text-white shadow'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          <Database className="h-3.5 w-3.5" /> Modèle de Données
        </button>
      </div>

      {/* Main Container */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-800">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
            {activeSection === 'script' && '🎬 Script de Démonstration Présentation Oral (5 Minutes)'}
            {activeSection === 'master' && '⭐ Prompt Maître Google AI Studio'}
            {activeSection === 'tracking' && '🚚 Prompt Connecteur Transporteurs'}
            {activeSection === 'assistant' && '🤖 Prompt Assistant IA (Shipment AI)'}
            {activeSection === 'rules' && '⚙️ Spécification des Règles Métier & Alertes'}
            {activeSection === 'database' && '🗄️ Schéma du Modèle de Données'}
          </h2>

          <button
            onClick={() => {
              const content =
                activeSection === 'script'
                  ? demoScript
                  : activeSection === 'master'
                  ? masterPrompt
                  : activeSection === 'tracking'
                  ? trackingPrompt
                  : activeSection === 'assistant'
                  ? assistantPrompt
                  : activeSection === 'rules'
                  ? rulesDoc
                  : databaseDoc;
              handleCopyText(activeSection, content);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
          >
            {copiedSection === activeSection ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" /> Copié dans le presse-papier !
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copier ce livrable
              </>
            )}
          </button>
        </div>

        <div className="mt-4">
          <pre className="text-xs font-sans text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-900/80 p-5 rounded-xl border border-slate-100 dark:border-slate-800 overflow-x-auto max-h-[60vh]">
            {activeSection === 'script' && demoScript}
            {activeSection === 'master' && masterPrompt}
            {activeSection === 'tracking' && trackingPrompt}
            {activeSection === 'assistant' && assistantPrompt}
            {activeSection === 'rules' && rulesDoc}
            {activeSection === 'database' && databaseDoc}
          </pre>
        </div>
      </div>
    </div>
  );
};
