import type { VercelRequest, VercelResponse } from '@vercel/node';
import { shareKey, isRateLimited, recordFailedAttempt, type ShareRecord } from '../../../src/share.js';
import { verifyPassword } from '../../_lib/hash.js';
import { kvClient } from '../../_lib/kv.js';

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(',')[0]?.trim() || 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const shareId = req.query.shareId as string;
  const { password } = (req.body ?? {}) as { password?: string };
  if (!shareId || !password) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  const ip = clientIp(req);
  if (await isRateLimited(kvClient, shareId, ip)) {
    res.status(429).json({ error: '잠시 후 다시 시도하세요' });
    return;
  }

  const record = await kvClient.get<ShareRecord>(shareKey(shareId));
  if (!record || !(await verifyPassword(password, record.passwordHash))) {
    await recordFailedAttempt(kvClient, shareId, ip);
    res.status(401).json({ error: '비밀번호가 틀렸습니다' });
    return;
  }

  res.status(200).json({ schedule: record.schedule });
}
