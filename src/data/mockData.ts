import { Shipment } from '../types';

/**
 * Base de données initiale vide.
 * Aucune fausse donnée (mock data) n'est injectée dans le code :
 * seules les expéditions réelles créées par l'utilisateur ou enregistrées
 * dans Neon PostgreSQL sont affichées.
 */
export const INITIAL_SHIPMENTS: Shipment[] = [];
