import type {
  TrackingProvider,
  TrackingResult,
} from './types';

export class Ship24Provider implements TrackingProvider {
  private apiKey: string;

  constructor() {
    if (!process.env.TRACKING_API_KEY) {
      throw new Error('TRACKING_API_KEY is missing');
    }

    this.apiKey = process.env.TRACKING_API_KEY;
  }

  async getTracking(
    trackingNumber: string,
    carrier?: string | null
  ): Promise<TrackingResult> {
    const response = await fetch(
      'https://api.ship24.com/public/v1/tracking/search',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trackingNumber,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Ship24 API error ${response.status}: ${errorText}`
      );
    }

    const data: any = await response.json();

    const tracking =
      data?.data?.trackings?.[0] ?? null;

    const events =
      tracking?.events ?? [];

    const latestEvent =
      events[0] ?? null;

    const status =
      tracking?.shipment?.statusMilestone ??
      latestEvent?.statusMilestone ??
      latestEvent?.statusCode ??
      null;

    return {
      status,

      location:
        latestEvent?.location ??
        latestEvent?.locationDetails ??
        null,

      eventDate:
        latestEvent?.occurrenceDatetime ??
        null,

      eta:
        tracking?.shipment?.delivery?.estimatedDeliveryDate ??
        tracking?.shipment?.delivery?.aiPredictiveDeliveryDate ??
        null,

      delivered:
        String(status).toLowerCase() === 'delivered',

      raw: data,
    };
  }
}
