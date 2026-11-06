# API du miroir Odoo DIGI LOGISTIC : spécification

Ce document décrit l'API que l'application **Shipment Manager** appelle pour
récupérer les factures fournisseurs DIGI LOGISTIC adressées à **NextHope**.

L'API lit une **copie PostgreSQL de la base Odoo** (base miroir). Elle est
hébergée hors de Shipment Manager. L'application ne se connecte jamais à cette
base : elle se contente d'appeler les deux routes décrites ici.

---

## 1. Fonctionnement côté application

La synchronisation tourne une fois par jour (cron à 05:00 UTC). Elle peut aussi
être lancée à la main depuis l'application. À chaque exécution :

1. L'app appelle **`GET /invoices/index`**, qui renvoie une liste légère de
   toutes les factures du périmètre : id, état et date de dernière
   modification.
2. Elle compare cette liste avec ce qu'elle a déjà en base :
   - facture **annulée** (`state = cancel`) déjà connue → elle la **supprime** ;
   - facture **inconnue**, ou dont le `sync_date` a changé → elle la **relit** ;
   - facture connue mais **absente de l'index** → elle la marque « Absente
     d'Odoo » (sans la supprimer) ;
   - sinon, elle ne fait rien.
3. Elle appelle **`POST /invoices/details`** par lots de **100 ids au plus**,
   uniquement pour les factures à relire.

L'app identifie chaque facture par son **id Odoo** (`account_move.id`).
L'API doit donc renvoyer l'id d'origine d'Odoo, jamais un id propre au miroir.
Sinon l'app crée des doublons.

---

## 2. Généralités

| Élément | Valeur |
|---|---|
| URL de base | Libre : elle est configurée côté app dans `MIRROR_API_URL`, par exemple `https://mirror.example.com/api` |
| Protocole | **HTTPS**, joignable depuis Vercel |
| Authentification | En-tête `Authorization: Bearer <clé>`. La clé est configurée côté app dans `MIRROR_API_KEY` |
| Format | JSON (UTF-8). Les réponses sont enveloppées dans `{ "items": [...] }` |
| Accès à la base | Utilisateur PostgreSQL **en lecture seule** |
| Délai | L'app abandonne un appel au bout de **60 s** |

### Codes HTTP attendus

| Code | Cas | Effet côté app |
|---|---|---|
| `200` | Succès | Synchronisation |
| `401` / `403` | Clé absente ou invalide | Message « Clé de l'API du miroir Odoo refusée. » |
| `400` | Corps invalide (ids manquants, plus de 100 ids…) | Message d'erreur générique |
| `5xx` | Erreur interne | Message d'erreur générique, synchro marquée en échec |

L'app n'affiche pas le contenu des erreurs : un corps JSON simple suffit, par
exemple `{ "error": "..." }`.

---

## 3. `GET /invoices/index`

Liste légère de **toutes** les factures du périmètre, **annulées comprises**.

### Réponse

```json
{
  "items": [
    { "odoo_move_id": 101, "state": "posted", "sync_date": "2026-10-29T08:12:45.123456" },
    { "odoo_move_id": 102, "state": "draft",  "sync_date": "2026-10-28T16:03:10.000412" },
    { "odoo_move_id": 103, "state": "cancel", "sync_date": "2026-10-27T09:45:00.551000" }
  ]
}
```

| Champ | Type | Description |
|---|---|---|
| `odoo_move_id` | entier | `account_move.id` |
| `state` | texte | `draft`, `posted` ou `cancel` |
| `sync_date` | texte | Dernière modification de la facture **ou de l'une de ses lignes** (voir §5) |

### Requête SQL

```sql
SELECT
    m.id    AS odoo_move_id,
    m.state AS state,
    to_char(
        GREATEST(m.write_date,
                 COALESCE((SELECT MAX(l.write_date)
                           FROM account_move_line l
                           WHERE l.move_id = m.id), m.write_date)),
        'YYYY-MM-DD"T"HH24:MI:SS.US'
    ) AS sync_date
FROM account_move m
WHERE m.move_type = 'in_invoice'                              -- + 'in_refund' pour les avoirs
  AND m.state IN ('draft', 'posted', 'cancel')                -- cancel obligatoire
  AND m.dest_partner_id = (SELECT value::int FROM ir_config_parameter
                           WHERE key = 'partner.nexthope.id')
ORDER BY m.id;
```

---

## 4. `POST /invoices/details`

Détail complet des factures demandées.

### Requête

```http
POST /invoices/details
Authorization: Bearer <clé>
Content-Type: application/json

{ "ids": [101, 102] }
```

- Au plus **100 ids** par appel (au-delà, renvoyer `400`).
- Un id inconnu ou hors périmètre est **simplement absent** de la réponse : ce
  n'est pas une erreur.

### Réponse

```json
{
  "items": [
    {
      "odoo_move_id": 101,
      "name": "FACTU/2026/0012",
      "state": "posted",
      "sync_date": "2026-10-29T08:12:45.123456",
      "partner_id": 7,
      "partner_name": "DIGI LOGISTIC",
      "dest_partner_id": 884,
      "dest_partner_name": "NextHope",
      "ref": "F-2026-0457",
      "invoice_date": "2026-10-20",
      "num_cmd_amz": "405-1234567-1234567",
      "sale_move_ids": [
        { "id": 5501, "name": "FAC/2026/0981" }
      ],
      "invoice_lines": [
        {
          "id": 90001,
          "name": "Clavier USB",
          "product_name": "Clavier USB AZERTY",
          "quantity": 2,
          "price_unit": 10.0,
          "price_subtotal": 20.0
        },
        {
          "id": 90002,
          "name": "",
          "product_name": "[DEEE] Éco-participation",
          "quantity": 1,
          "price_unit": 0.5,
          "price_subtotal": 0.5
        }
      ]
    }
  ]
}
```

| Champ | Type | Source Odoo |
|---|---|---|
| `odoo_move_id` | entier | `account_move.id` |
| `name` | texte | `account_move.name` |
| `state` | texte | `account_move.state` |
| `sync_date` | texte | Calculé, **identique** à `/invoices/index` |
| `partner_id`, `partner_name` | entier, texte | Fournisseur : `partner_id` → `res_partner.name` |
| `dest_partner_id`, `dest_partner_name` | entier, texte | Entité de destination : `dest_partner_id` → `res_partner.name` |
| `ref` | texte ou `null` | Référence de la facture fournisseur |
| `invoice_date` | texte `AAAA-MM-JJ` ou `null` | `account_move.invoice_date` |
| `num_cmd_amz` | texte ou `null` | Commande Amazon |
| `sale_move_ids` | liste `{ id, name }` | Factures de vente liées (`account_move_sale_rel`) ; `[]` si aucune |
| `invoice_lines` | liste | Lignes de type produit uniquement ; `[]` si aucune |
| `invoice_lines[].id` | entier | `account_move_line.id` |
| `invoice_lines[].name` | texte, **brut** | Libellé de la ligne, peut être vide ou `null` |
| `invoice_lines[].product_name` | texte ou `null` | Nom du produit |
| `quantity`, `price_unit`, `price_subtotal` | nombre | Les nombres envoyés en texte (`"20.00"`) sont aussi acceptés |

### Requête SQL

```sql
-- $1 = ids du corps de la requête (int[])
SELECT
    m.id                AS odoo_move_id,
    m.name              AS name,
    m.state             AS state,
    to_char(
        GREATEST(m.write_date,
                 COALESCE((SELECT MAX(l.write_date)
                           FROM account_move_line l
                           WHERE l.move_id = m.id), m.write_date)),
        'YYYY-MM-DD"T"HH24:MI:SS.US'
    )                   AS sync_date,
    m.partner_id        AS partner_id,
    p.name              AS partner_name,
    m.dest_partner_id   AS dest_partner_id,
    dp.name             AS dest_partner_name,
    m.ref               AS ref,
    to_char(m.invoice_date, 'YYYY-MM-DD') AS invoice_date,
    m.num_cmd_amz       AS num_cmd_amz,
    COALESCE((
        SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.id)
        FROM account_move_sale_rel r
        JOIN account_move s ON s.id = r.sale_move_id
        WHERE r.purchase_move_id = m.id
    ), '[]')            AS sale_move_ids,
    COALESCE((
        SELECT json_agg(json_build_object(
                   'id',             l.id,
                   'name',           l.name,
                   'product_name',   COALESCE(pt.name->>'fr_FR', pt.name->>'en_US'),
                   'quantity',       l.quantity,
                   'price_unit',     l.price_unit,
                   'price_subtotal', l.price_subtotal
               ) ORDER BY l.sequence, l.id)
        FROM account_move_line l
        LEFT JOIN product_product  pp ON pp.id = l.product_id
        LEFT JOIN product_template pt ON pt.id = pp.product_tmpl_id
        WHERE l.move_id = m.id
          AND l.display_type = 'product'
    ), '[]')            AS invoice_lines
FROM account_move m
JOIN res_partner dp     ON dp.id = m.dest_partner_id
LEFT JOIN res_partner p ON p.id  = m.partner_id
WHERE m.id = ANY($1::int[])
  AND m.move_type = 'in_invoice'                              -- même périmètre que /invoices/index
  AND m.dest_partner_id = (SELECT value::int FROM ir_config_parameter
                           WHERE key = 'partner.nexthope.id')
ORDER BY m.id;
```

---

## 5. Règles impératives

1. **`sync_date` doit être identique au caractère près dans les deux routes.**
   L'app compare des chaînes : si le format change d'une route à l'autre, ou
   si l'API reconvertit la valeur en date avant de la sérialiser, les mêmes
   factures sont relues à chaque synchronisation. Renvoyez le texte produit par
   `to_char` tel quel.
2. **Les factures annulées doivent être dans l'index.** C'est le seul moyen
   pour l'app de retirer une facture annulée après coup.
3. **Le périmètre doit être le même dans les deux routes** : type de pièce,
   destination NextHope.
4. **`invoice_date` doit être du texte `AAAA-MM-JJ`.** Un objet date sérialisé
   par le serveur peut se décaler d'un jour selon le fuseau horaire.
5. **`name` reste brut et `product_name` est envoyé à part.** L'app applique
   elle-même le repli sur le nom du produit quand le libellé est vide, et
   reconnaît les lignes de frais (`[DEEE]`, `[RCP]`, `[FRDP]`) grâce au nom du
   produit.
6. **Lecture seule** : l'API n'écrit jamais dans la base.

---

## 6. Paramètres du périmètre

Ces réglages se changent uniquement dans les requêtes de l'API, toujours de la
même façon dans les deux routes :

| Réglage | Valeur actuelle | Pour changer |
|---|---|---|
| Destination | `ir_config_parameter` `partner.nexthope.id` (884) | — |
| Types de pièce | `in_invoice` (factures fournisseur) | Avoirs : `IN ('in_invoice', 'in_refund')` |
| Brouillons | Inclus | Pour ne garder que les validées, retirer `'draft'` de l'index (garder `'cancel'`) |
| Nom du produit | `pt.name->>'fr_FR'` (Odoo 16+, nom en `jsonb`) | Odoo ≤ 15 : `pt.name` |

---

## 7. Recette (à vérifier avant mise en service)

- [ ] Sans en-tête `Authorization`, ou avec une mauvaise clé → `401`.
- [ ] `GET /invoices/index` renvoie des factures `draft`, `posted` **et** `cancel`.
- [ ] Pour un même id, `sync_date` est **strictement identique** dans
      `/invoices/index` et `/invoices/details`.
- [ ] Modifier une **ligne** d'une facture dans Odoo change son `sync_date`
      (une fois la modification répliquée dans le miroir).
- [ ] `POST /invoices/details` avec 101 ids → `400`.
- [ ] `POST /invoices/details` avec un id inconnu → `200`, facture absente de
      `items`.
- [ ] `invoice_date` est au format `AAAA-MM-JJ`, sans heure.
- [ ] Une facture sans ligne ni facture de vente renvoie `[]`, pas `null`.
- [ ] Une ligne au libellé vide renvoie bien son `product_name`.
- [ ] Temps de réponse de l'index : quelques secondes au plus. L'app abandonne
      un appel au bout de 60 s.
