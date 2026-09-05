import { neon } from '@neondatabase/serverless';
import { Ship24Provider } from './ship24';

export async function updateActiveTracking() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing');
  }

  const sql = neon(process.env.DATABASE_URL);
  const provider = new Ship24Provider();

  const shipments = await sql`
    SELECT
      id,
      tracking_no,
      carrier
    FROM shipments
    WHERE tracking_no IS NOT NULL
      AND TRIM(tracking_no) <> ''
      AND actual_delivery IS NULL
    ORDER BY tracking_last_checked_at ASC NULLS FIRST
    LIMIT 200
  `;

  let updated = 0;
  let failed = 0;

  for (const shipment of shipments) {
    try {
      const result = await provider.getTracking(
        shipment.tracking_no,
        shipment.carrier
      );

      await sql`
        UPDATE shipments
        SET
          carrier_status = ${result.status},
          carrier_last_location = ${result.location},
          carrier_status_date = ${result.eventDate},
          eta = COALESCE(${result.eta ?? null}, eta),
          tracking_last_checked_at = NOW(),
          tracking_last_event_at =
            COALESCE(
              ${result.eventDate ?? null}::timestamptz,
              tracking_last_event_at
            ),
          tracking_provider = 'ship24',
          tracking_raw = ${JSON.stringify(result.raw)}::jsonb,
          actual_delivery =
            CASE
              WHEN ${result.delivered} = true
              THEN COALESCE(actual_delivery, NOW())
              ELSE actual_delivery
            END,
          updated_at = NOW()
        WHERE id = ${shipment.id}
      `;

      updated++;
    } catch (error) {
      failed++;

      await sql`
        UPDATE shipments
        SET tracking_last_checked_at = NOW()
        WHERE id = ${shipment.id}
      `;
    }
  }

  return {
    total: shipments.length,
    updated,
    failed,
  };
}
