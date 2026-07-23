import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  shareKey, photosKey, countPhotosForPlace, MAX_PHOTOS_PER_PLACE,
  type ShareRecord, type PhotoMeta,
} from '../../../src/share.js';
import { verifyPassword } from '../../_lib/hash.js';
import { kvClient } from '../../_lib/kv.js';
import { putPhoto } from '../../_lib/blob.js';

async function authenticate(shareId: string, password: string | undefined): Promise<ShareRecord | null> {
  if (!password) return null;
  const record = await kvClient.get<ShareRecord>(shareKey(shareId));
  if (!record) return null;
  return (await verifyPassword(password, record.passwordHash)) ? record : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const shareId = req.query.shareId as string;
  if (!shareId) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  if (req.method === 'GET') {
    const headerPassword = req.headers['x-trip-password'];
    const password = Array.isArray(headerPassword) ? headerPassword[0] : headerPassword;
    const record = await authenticate(shareId, password);
    if (!record) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    const photos = (await kvClient.get<PhotoMeta[]>(photosKey(shareId))) ?? [];
    res.status(200).json({ photos });
    return;
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as {
      password?: string;
      placeId?: number | null;
      slotId?: number | null;
      caption?: string;
      fileBase64?: string;
      contentType?: string;
    };
    const record = await authenticate(shareId, body.password);
    if (!record) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    if (!body.fileBase64) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const photos = (await kvClient.get<PhotoMeta[]>(photosKey(shareId))) ?? [];
    const placeId = body.placeId ?? null;
    if (countPhotosForPlace(photos, placeId) >= MAX_PHOTOS_PER_PLACE) {
      res.status(400).json({ error: '이 장소는 이미 사진 4장이 채워져 있습니다' });
      return;
    }

    const id = crypto.randomUUID();
    const ext = body.contentType === 'image/png' ? 'png' : 'jpg';
    const buffer = Buffer.from(body.fileBase64, 'base64');
    const { url } = await putPhoto(shareId, id, ext, buffer);

    const meta: PhotoMeta = {
      id, placeId, slotId: body.slotId ?? null,
      caption: body.caption ?? '', ts: Date.now(), blobUrl: url,
    };
    await kvClient.set(photosKey(shareId), [...photos, meta]);
    res.status(200).json({ photo: meta });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
