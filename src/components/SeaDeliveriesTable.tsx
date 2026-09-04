import React, { useState } from 'react';
import {
  Package,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Search,
  Box,
  Layers,
  Edit2,
  Save,
  Truck,
} from 'lucide-react';
import { SeaDeliveryItem, DeliveryType, RecepRouenStatus, Shipment } from '../types';

interface SeaDeliveriesTableProps {
  shipment: Shipment;
  onUpdateShipment: (updated: Shipment) => void;
  canEdit?: boolean;
}

export const SeaDeliveriesTable: React.FC<SeaDeliveriesTableProps> = ({
  shipment,
  onUpdateShipment,
  canEdit = true,
}) => {
  const deliveries = shipment.sea_deliveries || [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<SeaDeliveryItem | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<string | null>(null);

  // Helper to re-index item_no sequentially: "01", "02", "03"...
  const formatItemNo = (index: number) => {
    const num = index + 1;
    return num < 10 ? `0${num}` : `${num}`;
  };

  const handleAddRow = () => {
    const newIndex = deliveries.length;
    const newItem: SeaDeliveryItem = {
      id: `DEL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      item_no: formatItemNo(newIndex),
      description: '',
      colisage_info: '',
      volume_m3: 0,
      supplier: shipment.supplier || '',
      delivery_type: 'Livraison par fournisseur',
      tracking_no: '',
      carrier: '',
      carrier_delivery_status: '',
      recep_rouen: 'A confirmer svp',
      remarks: '',
    };

    const updatedDeliveries = [...deliveries, newItem];
    const updatedShipment = {
      ...shipment,
      sea_deliveries: updatedDeliveries,
      updated_at: new Date().toISOString().split('T')[0],
    };
    onUpdateShipment(updatedShipment);
    // Start editing the newly added row
    setEditingId(newItem.id);
    setEditingRow(newItem);
  };

  const handleDeleteRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedDeliveries = deliveries
      .filter((d) => d.id !== id)
      .map((item, idx) => ({
        ...item,
        item_no: formatItemNo(idx),
      }));

    onUpdateShipment({
      ...shipment,
      sea_deliveries: updatedDeliveries,
      updated_at: new Date().toISOString().split('T')[0],
    });

    if (editingId === id) {
      setEditingId(null);
      setEditingRow(null);
    }
  };

  const handleStartEdit = (item: SeaDeliveryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditingRow({ ...item });
  };

  const handleSaveEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingRow) return;

    const updatedDeliveries = deliveries.map((d) =>
      d.id === editingRow.id ? editingRow : d
    );

    onUpdateShipment({
      ...shipment,
      sea_deliveries: updatedDeliveries,
      updated_at: new Date().toISOString().split('T')[0],
    });

    setEditingId(null);
    setEditingRow(null);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditingRow(null);
  };

  const handleRefreshTrackingItem = (item: SeaDeliveryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRefreshing(item.id);

    setTimeout(() => {
      const statuses = [
        'Livré au quai Rouen',
        'En cours de déchargement Rouen',
        'En transit vers Hub Rouen',
        'Prise en charge plateforme',
      ];
      const newStatus = statuses[Math.floor(Math.random() * statuses.length)];
      const autoRouen: RecepRouenStatus =
        newStatus.includes('Livré') || newStatus.includes('déchargement')
          ? 'Oui'
          : 'A confirmer svp';

      const updatedDeliveries = deliveries.map((d) =>
        d.id === item.id
          ? {
              ...d,
              carrier_delivery_status: newStatus,
              recep_rouen: autoRouen,
            }
          : d
      );

      onUpdateShipment({
        ...shipment,
        sea_deliveries: updatedDeliveries,
        updated_at: new Date().toISOString().split('T')[0],
      });

      setIsRefreshing(null);
    }, 800);
  };

  // Quick total calculations
  const totalVolume = deliveries.reduce((acc, curr) => acc + (Number(curr.volume_m3) || 0), 0);
  const totalReceived = deliveries.filter((d) => d.recep_rouen === 'Oui').length;

  return (
    <div className="mt-3 rounded-2xl border border-indigo-100 bg-slate-50/70 p-4 shadow-inner dark:border-indigo-950 dark:bg-slate-900/80">
      {/* Sub-table Header & Summaries */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-indigo-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
            <Package className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              Suivi des Livraisons chez le Transitaire (Hub de Rouen)
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                {deliveries.length} ligne{deliveries.length > 1 ? 's' : ''}
              </span>
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Réception des sous-colis en entrepôt avant empotage maritime • Volume total:{' '}
              <strong className="text-indigo-600 dark:text-indigo-400">{totalVolume.toFixed(2)} m³</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Summary Badge */}
          <div className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <span>Statut Réception Rouen:</span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono font-extrabold ${
                totalReceived === deliveries.length && deliveries.length > 0
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {totalReceived} / {deliveries.length} Reçus
            </span>
          </div>

          {canEdit && (
            <button
              onClick={handleAddRow}
              className="flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700"
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter une Ligne
            </button>
          )}
        </div>
      </div>

      {/* Table Section */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-950">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-bold dark:bg-slate-900 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="px-3 py-2 text-center w-12">N°</th>
              <th className="px-3 py-2 min-w-[150px]">Descriptions</th>
              <th className="px-3 py-2 min-w-[180px]">Infos colisage (Nb, dim., poids)</th>
              <th className="px-3 py-2 min-w-[90px] text-center">Vol. est. (m³)</th>
              <th className="px-3 py-2 min-w-[130px]">Fournisseurs</th>
              <th className="px-3 py-2 min-w-[160px]">Livraison</th>
              <th className="px-3 py-2 min-w-[130px]">N° Suivi Transporteur</th>
              <th className="px-3 py-2 min-w-[110px]">Transporteur</th>
              <th className="px-3 py-2 min-w-[170px]">Statut Livraison</th>
              <th className="px-3 py-2 min-w-[120px] text-center">Récep à Rouen</th>
              <th className="px-3 py-2 min-w-[150px]">Remarque</th>
              {canEdit && <th className="px-3 py-2 text-right w-20">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {deliveries.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                  Aucun colis enregistrés pour cette expédition maritime.
                  {canEdit && (
                    <button
                      onClick={handleAddRow}
                      className="ml-2 font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      + Ajouter la première ligne
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              deliveries.map((item, index) => {
                const isEditing = editingId === item.id;
                const rowData = isEditing ? editingRow! : item;

                return (
                  <tr
                    key={item.id}
                    className={`transition hover:bg-slate-50/80 dark:hover:bg-slate-900/60 ${
                      isEditing ? 'bg-indigo-50/50 dark:bg-indigo-950/30' : ''
                    }`}
                  >
                    {/* N° (Automatique) */}
                    <td className="px-3 py-2.5 text-center font-mono font-extrabold text-slate-700 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-900">
                      {item.item_no}
                    </td>

                    {/* Descriptions */}
                    <td className="px-3 py-2.5 font-medium">
                      {isEditing ? (
                        <input
                          type="text"
                          value={rowData.description}
                          onChange={(e) =>
                            setEditingRow({ ...rowData, description: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      ) : (
                        <span className="text-slate-900 dark:text-slate-100 font-semibold">
                          {item.description}
                        </span>
                      )}
                    </td>

                    {/* Infos colisage */}
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                      {isEditing ? (
                        <input
                          type="text"
                          value={rowData.colisage_info}
                          onChange={(e) =>
                            setEditingRow({ ...rowData, colisage_info: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      ) : (
                        <span className="text-[11px]">{item.colisage_info}</span>
                      )}
                    </td>

                    {/* Volume estimé (m³) */}
                    <td className="px-3 py-2.5 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={rowData.volume_m3}
                          onChange={(e) =>
                            setEditingRow({ ...rowData, volume_m3: parseFloat(e.target.value) || 0 })
                          }
                          className="w-16 rounded-lg border border-slate-300 bg-white p-1 text-center text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      ) : (
                        `${item.volume_m3} m³`
                      )}
                    </td>

                    {/* Fournisseurs */}
                    <td className="px-3 py-2.5 text-slate-800 dark:text-slate-200 font-semibold">
                      {isEditing ? (
                        <input
                          type="text"
                          value={rowData.supplier}
                          onChange={(e) =>
                            setEditingRow({ ...rowData, supplier: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      ) : (
                        item.supplier
                      )}
                    </td>

                    {/* Livraison (Liste déroulante) */}
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <select
                          value={rowData.delivery_type}
                          onChange={(e) =>
                            setEditingRow({
                              ...rowData,
                              delivery_type: e.target.value as DeliveryType,
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        >
                          <option value="Livraison par fournisseur">Livraison par fournisseur</option>
                          <option value="Enlèvement à prévoir">Enlèvement à prévoir</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                            item.delivery_type === 'Livraison par fournisseur'
                              ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                              : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                          }`}
                        >
                          <Truck className="h-3 w-3" /> {item.delivery_type}
                        </span>
                      )}
                    </td>

                    {/* N° de suivi transporteur */}
                    <td className="px-3 py-2.5 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {isEditing ? (
                        <input
                          type="text"
                          value={rowData.tracking_no}
                          onChange={(e) =>
                            setEditingRow({ ...rowData, tracking_no: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      ) : (
                        item.tracking_no
                      )}
                    </td>

                    {/* Transporteur */}
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 font-medium">
                      {isEditing ? (
                        <input
                          type="text"
                          value={rowData.carrier}
                          onChange={(e) =>
                            setEditingRow({ ...rowData, carrier: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      ) : (
                        item.carrier
                      )}
                    </td>

                    {/* Statut de livraison transporteur (Recherche comme aérienne) */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-1">
                        {isEditing ? (
                          <input
                            type="text"
                            value={rowData.carrier_delivery_status}
                            onChange={(e) =>
                              setEditingRow({
                                ...rowData,
                                carrier_delivery_status: e.target.value,
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                          />
                        ) : (
                          <>
                            <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                              {item.carrier_delivery_status}
                            </span>
                            <button
                              onClick={(e) => handleRefreshTrackingItem(item, e)}
                              disabled={isRefreshing === item.id}
                              className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800"
                              title="Recherche comme aérienne (Live status)"
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${
                                  isRefreshing === item.id ? 'animate-spin text-indigo-600' : ''
                                }`}
                              />
                            </button>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Récep à Rouen (Liste déroulante) */}
                    <td className="px-3 py-2.5 text-center">
                      {isEditing ? (
                        <select
                          value={rowData.recep_rouen}
                          onChange={(e) =>
                            setEditingRow({
                              ...rowData,
                              recep_rouen: e.target.value as RecepRouenStatus,
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        >
                          <option value="Oui">Oui</option>
                          <option value="Non">Non</option>
                          <option value="A confirmer svp">A confirmer svp</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                            item.recep_rouen === 'Oui'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : item.recep_rouen === 'Non'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {item.recep_rouen === 'Oui' && <CheckCircle2 className="h-3 w-3" />}
                          {item.recep_rouen === 'Non' && <XCircle className="h-3 w-3" />}
                          {item.recep_rouen === 'A confirmer svp' && <HelpCircle className="h-3 w-3" />}
                          {item.recep_rouen}
                        </span>
                      )}
                    </td>

                    {/* Remarque */}
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 text-[11px]">
                      {isEditing ? (
                        <input
                          type="text"
                          value={rowData.remarks}
                          onChange={(e) =>
                            setEditingRow({ ...rowData, remarks: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      ) : (
                        item.remarks || '—'
                      )}
                    </td>

                    {/* Actions */}
                    {canEdit && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={handleSaveEdit}
                                className="rounded-lg bg-emerald-600 p-1 text-white hover:bg-emerald-700"
                                title="Valider"
                              >
                                <Save className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                className="rounded-lg bg-slate-200 p-1 text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300"
                                title="Annuler"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={(e) => handleStartEdit(item, e)}
                                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-800"
                                title="Modifier la ligne"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={(e) => handleDeleteRow(item.id, e)}
                                className="rounded-lg p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950"
                                title="Supprimer la ligne"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
