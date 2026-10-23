/** Downscale a camera photo to a JPEG data URL (max edge 960 px) so reports stay light on mobile data. */
export async function photoToDataUrl(file: File, maxEdge = 960, quality = 0.72): Promise<string> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      const g = canvas.getContext('2d');
      if (g) {
        g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close?.();
        return canvas.toDataURL('image/jpeg', quality);
      }
    }
  } catch {
    /* fall through to the plain reader */
  }
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
