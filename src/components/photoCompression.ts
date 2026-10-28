/** Longest side of a stored photo: enough to read a label, a few hundred KB. */
export const PHOTO_MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;

/**
 * Resizes a photo in the browser (longest side 1600 px) and re-encodes it as
 * JPEG before upload. EXIF orientation is applied by the browser decoder.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} n'est pas une image.`);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => {
    throw new Error(`${file.name} : image illisible (format non pris en charge par le navigateur).`);
  });
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Compression impossible dans ce navigateur.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Compression impossible dans ce navigateur.');
  return blob;
}
