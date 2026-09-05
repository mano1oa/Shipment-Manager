export interface TrackingResult {
  status: string | null;
  location: string | null;
  eventDate: string | null;
  eta?: string | null;
  delivered: boolean;
  raw: unknown;
}

export interface TrackingProvider {
  getTracking(
    trackingNumber: string,
    carrier?: string | null
  ): Promise<TrackingResult>;
}
