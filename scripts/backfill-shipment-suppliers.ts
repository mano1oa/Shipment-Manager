/**
 * One-off: rewrites the supplier label of the existing shipments from their
 * invoices ("Fournisseur A, Fournisseur B" instead of "3 fournisseurs").
 *
 *   npx tsx scripts/backfill-shipment-suppliers.ts           # shows what would change, writes nothing
 *   npx tsx scripts/backfill-shipment-suppliers.ts --apply   # writes the changes
 *
 * Reads DATABASE_URL (or POSTGRES_URL) from the environment or the .env file.
 * Shipments without any linked invoice keep their current label.
 */
import dotenv from 'dotenv';
import { getDb } from '../src/db/neon.ts';
import { listDigiInvoicesForShipment } from '../src/db/digiInvoices.ts';
import { shipmentSupplierLabel } from '../src/lib/shipmentSuppliers.ts';

dotenv.config();

async function main() {
  const apply = process.argv.includes('--apply');
  const sql = getDb();
  const shipments = (await sql`SELECT id, supplier FROM shipments ORDER BY id`) as {
    id: string;
    supplier: string | null;
  }[];

  let changed = 0;
  let withoutInvoice = 0;
  for (const s of shipments) {
    const invoices = await listDigiInvoicesForShipment(s.id);
    if (invoices.length === 0) {
      withoutInvoice++;
      continue;
    }
    const label = shipmentSupplierLabel(invoices.map((i) => i.supplier_display));
    if (label === (s.supplier ?? '')) continue;
    changed++;
    console.log(`${s.id} : « ${s.supplier ?? ''} » → « ${label} »`);
    if (apply) await sql`UPDATE shipments SET supplier = ${label} WHERE id = ${s.id}`;
  }

  console.log(
    `\n${shipments.length} expédition(s) lue(s) · ${changed} à corriger · ${withoutInvoice} sans facture (laissées telles quelles).`
  );
  console.log(apply ? 'Modifications enregistrées.' : 'Aucune écriture : relancez avec --apply pour enregistrer.');
}

main().catch((error) => {
  console.error('Échec du recalcul des fournisseurs :', error);
  process.exit(1);
});
