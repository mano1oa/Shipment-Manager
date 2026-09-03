[README.md](https://github.com/user-attachments/files/31800525/README.md)
# 📦 Supply Chain Control Tower

> Plateforme de pilotage Supply Chain développée pour NextHope

---

# Objectif

Supply Chain Control Tower est une application web destinée à remplacer le Google Sheet actuellement utilisé pour le suivi des imports.

L'objectif est de centraliser l'ensemble des opérations Supply Chain afin de disposer d'une visibilité temps réel sur toutes les commandes, expéditions et réceptions.

---

# Fonctionnalités principales

## Gestion des fournisseurs

- Création des fournisseurs
- Informations de contact
- Incoterms
- Délais moyens
- Historique des commandes
- Performance fournisseur

---

## Gestion des commandes

- Création des Purchase Orders
- Validation
- Statuts
- Dates importantes
- Valeur des commandes
- Devise
- Conditions de paiement

---

## Gestion documentaire

Chaque commande peut contenir :

- Purchase Order
- Proforma Invoice
- Facture
- Packing List
- Bill of Lading
- Air Waybill
- Certificats
- Documents douaniers

---

## Suivi des expéditions

Transport :

- Maritime
- Aérien
- Routier

Informations :

- ETD
- ETA
- ATD
- ATA
- Container
- AWB
- BL
- Tracking

---

## Gestion des colis

Chaque colis possède :

- Tracking fournisseur
- Tracking transitaire
- Dimensions
- Poids
- Valeur
- Nombre d'articles
- Nombre de cartons
- Nombre de palettes

---

## Réceptions

Suivi des réceptions :

- Orly
- Entrepôt
- Madagascar
- Mali
- Niger

Historique complet.

---

## Dashboard

### KPI

- Valeur en transit
- Nombre de commandes
- Nombre de colis
- Retards
- Litiges
- OTIF
- Délai moyen
- Valeur stock

---

## Alertes automatiques

### Alertes transport

- ETA dépassée
- Livraison retardée
- Colis perdu
- Tracking inactif

---

### Alertes Supply Chain

- Facture manquante
- BL absent
- AWB absent
- PO incomplète
- Réception non confirmée
- Paiement en attente

---

## Recherche

Recherche par :

- Fournisseur
- Tracking
- Container
- AWB
- BL
- Facture
- PO
- Produit

---

# Workflow

```text
Création du besoin

        │

        ▼

Validation Achat

        │

        ▼

Création Purchase Order

        │

        ▼

Envoi fournisseur

        │

        ▼

Réception Proforma

        │

        ▼

Validation

        │

        ▼

Paiement

        │

        ▼

Préparation commande

        │

        ▼

Expédition

        │

        ▼

Tracking

        │

        ▼

Douane

        │

        ▼

Réception

        │

        ▼

Archivage
```

---

# Architecture

```text
                React / Next.js

                      │

        REST API / GraphQL

                      │

                Node.js

                      │

                PostgreSQL

                      │

------------------------------------------------

Amazon Business

Odoo

Transporteurs

MID EXPRESS

Email

Google Drive

```

---

# Structure du projet

```text
SupplyChainControlTower/

│

├── frontend/

│   ├── dashboard/

│   ├── components/

│   ├── pages/

│   ├── hooks/

│   └── utils/

│

├── backend/

│   ├── api/

│   ├── controllers/

│   ├── services/

│   ├── middleware/

│   ├── models/

│   ├── jobs/

│   └── notifications/

│

├── database/

│

├── docs/

│

├── scripts/

│

└── docker/

```

---

# Modules

## 1. Dashboard

Vue générale.

---

## 2. Fournisseurs

Gestion complète.

---

## 3. Commandes

Purchase Orders.

---

## 4. Expéditions

Suivi des transports.

---

## 5. Documents

GED intégrée.

---

## 6. Réceptions

Validation des arrivées.

---

## 7. Stocks

Entrées / sorties.

---

## 8. Alertes

Notifications automatiques.

---

## 9. Administration

Gestion des utilisateurs.

---

# Intégrations

## Odoo

Synchronisation :

- Fournisseurs
- Produits
- Factures
- Commandes

---

## Amazon Business

Import automatique :

- CSV
- Tracking
- Commandes
- Factures

---

## MID EXPRESS

Synchronisation :

- Tracking
- Réceptions
- Scan Orly

---

## Email

Lecture automatique :

- Factures
- AWB
- BL
- Notifications

---

# Base de données

## Tables principales

```
Users

Suppliers

PurchaseOrders

Shipments

Containers

Packages

Products

Invoices

Documents

Alerts

TrackingHistory

AuditLogs
```

---

# Rôles

## Administrateur

Accès complet.

---

## Supply Chain

Gestion complète des flux.

---

## Achat

Création des commandes.

---

## Comptabilité

Factures uniquement.

---

## Direction

Lecture seule.

---

# Tableau de bord

## Cartes principales

- Valeur des marchandises en transit
- Nombre de commandes ouvertes
- Commandes en retard
- Colis perdus
- Réceptions de la semaine
- Valeur des imports
- Temps moyen de dédouanement
- Performance fournisseurs

---

# Sécurité

- Authentification
- JWT
- HTTPS
- Journal d'audit
- Sauvegardes automatiques
- Gestion des permissions

---

# Roadmap

## Version 1

- Gestion des commandes
- Expéditions
- Documents
- Dashboard

---

## Version 2

- Synchronisation Odoo
- Synchronisation Amazon
- Notifications Teams / Google Chat
- Import automatique des emails

---

## Version 3

- IA de détection d'anomalies
- Prévision des retards
- Calcul automatique des ETA
- Recommandations Supply Chain

---

# Technologies

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- ShadCN UI

---

## Backend

- Node.js
- Express
- Prisma ORM

---

## Base de données

- PostgreSQL

---

## Déploiement

- Docker
- Nginx
- GitHub Actions

---

# Installation

```bash
git clone https://github.com/NextHope/SupplyChainControlTower.git

cd SupplyChainControlTower

npm install

npm run dev
```

---

# Variables d'environnement

```env
DATABASE_URL=

JWT_SECRET=

ODOO_URL=

ODOO_DATABASE=

ODOO_USERNAME=

ODOO_PASSWORD=

SMTP_HOST=

SMTP_PORT=

SMTP_USERNAME=

SMTP_PASSWORD=

AMAZON_API_KEY=
```

---

# Vision du projet

Supply Chain Control Tower a pour ambition de devenir l'outil central de pilotage des opérations logistiques de NextHope.

Il remplacera les fichiers Excel et Google Sheets actuellement utilisés en apportant :

- une visibilité temps réel des flux,
- une automatisation des tâches répétitives,
- une réduction des erreurs manuelles,
- une traçabilité complète des marchandises,
- des tableaux de bord décisionnels,
- des alertes intelligentes,
- une intégration native avec Odoo, Amazon Business et les transitaires.

À terme, la plateforme constituera une véritable **Control Tower Supply Chain**, capable d'anticiper les retards, détecter les anomalies et fournir des indicateurs fiables pour le pilotage opérationnel et stratégique.
