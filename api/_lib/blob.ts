import { del, put } from '@vercel/blob';

export async function delPhoto(url: string): Promise<void> {
  await del(url);
}

export async function putPhoto(
  shareId: string,
  id: string,
  ext: string,
  buffer: Buffer,
): Promise<{ url: string }> {
  const result = await put(`photos/${shareId}/${id}.${ext}`, buffer, { access: 'public' });
  return { url: result.url };
}
