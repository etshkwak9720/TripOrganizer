import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  shareKey, photosKey, countPhotosForPlace, MAX_PHOTOS_PER_PLACE,
  isRateLimited, recordFailedAttempt,
  type ShareRecord, type PhotoMeta,
} from '../../../src/share.js';
import { verifyPassword } from '../../_lib/hash.js';
import { kvClient } from '../../_lib/kv.js';
import { putPhoto, delPhoto } from '../../_lib/blob.js';

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(',')[0]?.trim() || 'unknown';
}

// 비밀번호 검증만 한다 — 실패 시 recordFailedAttempt를 호출하고, 성공 시엔 건드리지 않는다.
// rate limit 통과 여부(isRateLimited)는 호출부에서 이 함수를 부르기 전에 별도로 확인한다.
async function authenticate(shareId: string, password: string | undefined, ip: string): Promise<ShareRecord | null> {
  if (!password) {
    await recordFailedAttempt(kvClient, shareId, ip);
    return null;
  }
  const record = await kvClient.get<ShareRecord>(shareKey(shareId));
  if (!record || !(await verifyPassword(password, record.passwordHash))) {
    await recordFailedAttempt(kvClient, shareId, ip);
    return null;
  }
  return record;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const shareId = req.query.shareId as string;
  if (!shareId) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }
  const ip = clientIp(req);

  if (req.method === 'GET') {
    if (await isRateLimited(kvClient, shareId, ip)) {
      res.status(429).json({ error: '잠시 후 다시 시도하세요' });
      return;
    }
    const headerPassword = req.headers['x-trip-password'];
    const password = Array.isArray(headerPassword) ? headerPassword[0] : headerPassword;
    const record = await authenticate(shareId, password, ip);
    if (!record) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    const photos = (await kvClient.get<PhotoMeta[]>(photosKey(shareId))) ?? [];
    res.status(200).json({ photos });
    return;
  }

  if (req.method === 'POST') {
    if (await isRateLimited(kvClient, shareId, ip)) {
      res.status(429).json({ error: '잠시 후 다시 시도하세요' });
      return;
    }
    const body = (req.body ?? {}) as {
      password?: string;
      placeId?: number | null;
      slotId?: number | null;
      caption?: string;
      fileBase64?: string;
      contentType?: string;
      owner?: string;
    };
    const record = await authenticate(shareId, body.password, ip);
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
      caption: body.caption ?? '', ts: Date.now(), blobUrl: url, owner: body.owner,
    };
    await kvClient.set(photosKey(shareId), [...photos, meta]);
    res.status(200).json({ photo: meta });
    return;
  }

  if (req.method === 'DELETE') {
    if (await isRateLimited(kvClient, shareId, ip)) {
      res.status(429).json({ error: '잠시 후 다시 시도하세요' });
      return;
    }
    const body = (req.body ?? {}) as { password?: string; id?: string; owner?: string };
    const record = await authenticate(shareId, body.password, ip);
    if (!record) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    const photos = (await kvClient.get<PhotoMeta[]>(photosKey(shareId))) ?? [];
    const target = photos.find((p) => p.id === body.id);
    if (!target) {
      res.status(404).json({ error: '사진을 찾을 수 없습니다' });
      return;
    }
    if (!target.owner || target.owner !== body.owner) {
      res.status(403).json({ error: '본인이 올린 사진만 삭제할 수 있습니다' });
      return;
    }
    await delPhoto(target.blobUrl).catch(() => {});
    await kvClient.set(photosKey(shareId), photos.filter((p) => p.id !== body.id));
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
