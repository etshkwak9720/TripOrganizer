import type { Place, Slot, Member, Group, Trip } from './db.ts';

export interface KVClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

export const MAX_ATTEMPTS = 10;
export const ATTEMPT_WINDOW_SECONDS = 600; // 10분
export const MAX_PHOTOS_PER_PLACE = 4;

export function genShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function shareKey(shareId: string): string {
  return `trip:${shareId}`;
}

export function photosKey(shareId: string): string {
  return `trip:${shareId}:photos`;
}

export function attemptsKey(shareId: string, ip: string): string {
  return `trip:${shareId}:attempts:${ip}`;
}

export type ShareSnapshot = {
  trip: Pick<Trip, 'title' | 'startDate' | 'dayCount' | 'mode'>;
  members: Pick<Member, 'name' | 'groupId'>[];
  groups: Pick<Group, 'name' | 'score'>[];
  // id를 보존해야 slots[].placeId가 이 배열의 어느 장소를 가리키는지 참가자 화면에서 찾을 수 있다
  // (로컬 Dexie PK 그대로 — 배열 인덱스가 아님).
  places: (Pick<Place, 'name' | 'region' | 'kind' | 'address' | 'lat' | 'lng'> & { id: number })[];
  slots: Pick<Slot, 'dayIndex' | 'band' | 'plannedTime' | 'order' | 'placeId' | 'activityText'>[];
};

export interface ShareRecord {
  passwordHash: string;
  schedule: ShareSnapshot;
  updatedAt: number;
}

export interface PhotoMeta {
  id: string;
  placeId: number | null;
  slotId: number | null;
  caption: string;
  ts: number;
  blobUrl: string;
}

export async function checkRateLimit(kv: KVClient, shareId: string, ip: string): Promise<boolean> {
  const count = await kv.incr(attemptsKey(shareId, ip));
  if (count === 1) await kv.expire(attemptsKey(shareId, ip), ATTEMPT_WINDOW_SECONDS);
  return count <= MAX_ATTEMPTS;
}

export function countPhotosForPlace(photos: PhotoMeta[], placeId: number | null): number {
  return photos.filter((p) => p.placeId === placeId).length;
}
