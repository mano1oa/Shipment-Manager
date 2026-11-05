import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatQuantity } from './digiApi';
import { ReceivedArticle, receivedGap, saveReceivedQuantity } from './shipmentApi';

interface Props {
  article: ReceivedArticle;
  canEdit: boolean;
  /** Saved: new received quantity (null = cleared). */
  onSaved: (quantity: number | null) => void;
}

/** Received quantity of an article, saved when leaving the field or on Enter. */
export const ReceivedQuantityInput: React.FC<Props> = ({ article, canEdit, onSaved }) => {
  const current = article.quantity_received === null ? '' : String(article.quantity_received);
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValue(current), [current]);

  const gap = receivedGap(article);
  const tone =
    gap === null ? '' : gap === 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300';

  if (!canEdit) {
    return <span className={`font-semibold ${tone}`}>{article.quantity_received === null ? '—' : formatQuantity(article.quantity_received)}</span>;
  }

  const save = async () => {
    const text = value.trim().replace(',', '.');
    if (text === current) return;
    const quantity = text === '' ? null : Number(text);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
      setError('Quantité invalide');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveReceivedQuantity(article.invoice_id, article.position, quantity);
      onSaved(quantity);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex items-center justify-end gap-1">
      {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
      <input
        value={value}
        inputMode="decimal"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setValue(current);
        }}
        title={
          error ||
          (article.received_by_email ? `Saisi par ${article.received_by_email}` : 'Quantité reçue à Madagascar')
        }
        placeholder="—"
        className={`w-16 rounded-md border px-1.5 py-0.5 text-right text-xs font-semibold focus:border-[#623387] focus:outline-none dark:bg-slate-900 ${
          error ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'
        } ${tone}`}
      />
    </span>
  );
};
