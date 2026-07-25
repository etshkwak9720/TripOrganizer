import type { VercelRequest, VercelResponse } from '@vercel/node';
import { shareKey, isRateLimited, recordFailedAttempt, type ShareRecord, type ShareSnapshot } from '../../src/share.js';
import { hashPassword, verifyPassword } from '../_lib/hash.js';
import { kvClient } from '../_lib/kv.js';

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(',')[0]?.trim() || 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const shareId = req.query.shareId as string;
  if (!shareId) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }
  const ip = clientIp(req);

  // 참가자 새로고침: 최신 스냅샷 조회(비번은 헤더로만, 쿼리스트링 금지)
  if (req.method === 'GET') {
    if (await isRateLimited(kvClient, shareId, ip)) {
      res.status(429).json({ error: '잠시 후 다시 시도하세요' });
      return;
    }
    const header = req.headers['x-trip-password'];
    const password = Array.isArray(header) ? header[0] : header;
    const record = await kvClient.get<ShareRecord>(shareKey(shareId));
    if (!record || !password || !(await verifyPassword(password, record.passwordHash))) {
      await recordFailedAttempt(kvClient, shareId, ip);
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
    res.status(200).json({ schedule: record.schedule });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (await isRateLimited(kvClient, shareId, ip)) {
    res.status(429).json({ error: '잠시 후 다시 시도하세요' });
    return;
  }
  const { password, schedule } = (req.body ?? {}) as { password?: string; schedule?: ShareSnapshot };
  if (!password || !schedule) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  const existing = await kvClient.get<ShareRecord>(shareKey(shareId));
  const passwordHash = existing ? existing.passwordHash : await hashPassword(password);

  if (existing) {
    const ok = await verifyPassword(password, existing.passwordHash);
    if (!ok) {
      await recordFailedAttempt(kvClient, shareId, ip);
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
  }

  const record: ShareRecord = { passwordHash, schedule, updatedAt: Date.now() };
  await kvClient.set(shareKey(shareId), record);
  res.status(200).json({ ok: true });
}
