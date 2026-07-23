import type { VercelRequest, VercelResponse } from '@vercel/node';
import { shareKey, type ShareRecord, type ShareSnapshot } from '../../src/share.js';
import { hashPassword, verifyPassword } from '../_lib/hash.js';
import { kvClient } from '../_lib/kv.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const shareId = req.query.shareId as string;
  const { password, schedule } = (req.body ?? {}) as { password?: string; schedule?: ShareSnapshot };
  if (!shareId || !password || !schedule) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }

  const existing = await kvClient.get<ShareRecord>(shareKey(shareId));
  const passwordHash = existing ? existing.passwordHash : await hashPassword(password);

  if (existing) {
    const ok = await verifyPassword(password, existing.passwordHash);
    if (!ok) {
      res.status(401).json({ error: '비밀번호가 틀렸습니다' });
      return;
    }
  }

  const record: ShareRecord = { passwordHash, schedule, updatedAt: Date.now() };
  await kvClient.set(shareKey(shareId), record);
  res.status(200).json({ ok: true });
}
