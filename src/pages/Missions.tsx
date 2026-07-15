import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db, MISSION_TYPE_META,
  type Group, type Mission, type MissionResult, type Adjustment,
} from '../db';
import { recommendMissions, commonMissions, type MissionTemplate } from '../missions';
import { Icon, TopBar, Screen, EmptyState } from '../ui';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function Missions() {
  const { id } = useParams();
  const tripId = Number(id);
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const groups = useLiveQuery(() => db.groups.where('tripId').equals(tripId).toArray(), [tripId]);
  const places = useLiveQuery(() => db.places.where('tripId').equals(tripId).toArray(), [tripId]);
  const missions = useLiveQuery(() => db.missions.where('tripId').equals(tripId).toArray(), [tripId]);
  const results = useLiveQuery(() => db.missionResults.where('tripId').equals(tripId).toArray(), [tripId]);
  const adjustments = useLiveQuery(() => db.adjustments.where('tripId').equals(tripId).toArray(), [tripId]);
  const award = useLiveQuery(() => db.awards.get(tripId), [tripId]);

  const [adminOpen, setAdminOpen] = useState(false);

  if (!trip) return null;

  // --- live score computation ---
  const missionById = new Map((missions ?? []).map((m) => [m.id!, m]));
  const scoreOf = (groupId: number) => {
    let s = 0;
    for (const r of results ?? []) {
      if (r.groupId === groupId && r.done) s += missionById.get(r.missionId)?.points ?? 0;
    }
    for (const a of adjustments ?? []) if (a.groupId === groupId) s += a.delta;
    return s;
  };
  const ranked = [...(groups ?? [])]
    .map((g) => ({ group: g, score: scoreOf(g.id!) }))
    .sort((a, b) => b.score - a.score);
  const firstId = ranked[0]?.group.id;
  const lastId = ranked.length > 1 ? ranked[ranked.length - 1].group.id : undefined;

  if ((groups ?? []).length === 0) {
    return (
      <>
        <TopBar title="미션 · 랭킹" backTo="/" />
        <Screen>
          <EmptyState icon="diversity_3" title="모둠이 없어요" hint="'구성' 탭에서 모둠을 먼저 만들어 주세요" />
        </Screen>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="미션 · 랭킹"
        backTo="/"
        right={
          <button onClick={() => setAdminOpen(true)} className="chip bg-primary-container/15 text-primary-container">
            <Icon name="admin_panel_settings" className="text-[16px]" /> 관리자
          </button>
        }
      />
      <Screen>
        {/* ranking board */}
        <section className="card p-4 mb-4">
          <h2 className="font-head font-bold text-[16px] mb-3 flex items-center gap-1">
            <Icon name="leaderboard" className="text-primary-container" /> 실시간 모둠 랭킹
          </h2>
          <ul className="space-y-2">
            {ranked.map((r, i) => (
              <li key={r.group.id} className={`flex items-center gap-3 p-2 rounded-md ${i === 0 ? 'bg-primary-container/10' : ''}`}>
                <span className="w-7 text-center text-[18px]">{MEDAL[i] ?? i + 1}</span>
                <span className="flex-1 font-semibold">{r.group.name}</span>
                <span className="font-head font-extrabold text-primary-container tabular-nums">{r.score}점</span>
              </li>
            ))}
          </ul>
        </section>

        {/* awards: 1등 상 / 꼴찌 벌 */}
        <AwardsCard
          tripId={tripId}
          award={award}
          firstName={ranked[0]?.group.name}
          lastName={ranked.length > 1 ? ranked[ranked.length - 1].group.name : undefined}
        />

        {/* missions by place */}
        <h2 className="font-head font-bold text-[16px] mt-5 mb-2">장소별 미션</h2>
        <PlaceMissionSection
          tripId={tripId} placeId={null} title="공통 미션" recos={commonMissions()}
          groups={groups ?? []} missions={missions ?? []} results={results ?? []}
        />
        {(places ?? []).map((p) => (
          <PlaceMissionSection
            key={p.id} tripId={tripId} placeId={p.id!} title={p.name}
            recos={recommendMissions(p.name)}
            groups={groups ?? []} missions={missions ?? []} results={results ?? []}
          />
        ))}
      </Screen>

      {adminOpen && (
        <AdminSheet tripId={tripId} groups={groups ?? []} adjustments={adjustments ?? []}
          firstId={firstId} lastId={lastId} onClose={() => setAdminOpen(false)} />
      )}
    </>
  );
}

function AwardsCard({ tripId, award, firstName, lastName }: {
  tripId: number; award?: { firstGroupReward: string; lastGroupPenalty: string }; firstName?: string; lastName?: string;
}) {
  async function save(patch: Partial<{ firstGroupReward: string; lastGroupPenalty: string }>) {
    const cur = award ?? { tripId, firstGroupReward: '', lastGroupPenalty: '' };
    await db.awards.put({ ...cur, tripId, ...patch });
  }
  return (
    <section className="card p-4 mb-4">
      <h2 className="font-head font-bold text-[16px] mb-3 flex items-center gap-1">
        <Icon name="emoji_events" className="text-primary-container" /> 1등 상 · 꼴찌 벌
      </h2>
      <div className="space-y-3">
        <div>
          <label className="field-label">🥇 1등 모둠 상 {firstName && <span className="text-primary-container">— 현재 {firstName}</span>}</label>
          <input className="input" placeholder="예: 저녁 간식 쏘기" defaultValue={award?.firstGroupReward ?? ''}
            onBlur={(e) => save({ firstGroupReward: e.target.value })} />
        </div>
        <div>
          <label className="field-label">🐢 꼴찌 모둠 벌 {lastName && <span className="text-error">— 현재 {lastName}</span>}</label>
          <input className="input" placeholder="예: 장기자랑 한 곡" defaultValue={award?.lastGroupPenalty ?? ''}
            onBlur={(e) => save({ lastGroupPenalty: e.target.value })} />
        </div>
      </div>
    </section>
  );
}

async function toggleResult(tripId: number, missionId: number, groupId: number) {
  const existing = await db.missionResults.where('[missionId+groupId]').equals([missionId, groupId]).first();
  if (existing) await db.missionResults.update(existing.id!, { done: !existing.done, ts: Date.now() });
  else await db.missionResults.add({ tripId, missionId, groupId, done: true, ts: Date.now() });
}

function PlaceMissionSection({ tripId, placeId, title, recos, groups, missions, results }: {
  tripId: number; placeId: number | null; title: string;
  recos: MissionTemplate[]; groups: Group[]; missions: Mission[]; results: MissionResult[];
}) {
  const [pick, setPick] = useState(false);
  const mine = missions.filter((m) => (m.placeId ?? null) === placeId);
  const isDone = (mid: number, gid: number) =>
    results.find((r) => r.missionId === mid && r.groupId === gid)?.done ?? false;

  return (
    <section className="card p-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon name={placeId === null ? 'public' : 'place'} className="text-primary-container text-[20px]" />
        <span className="font-head font-bold flex-1">{title}</span>
        <button onClick={() => setPick(true)} className="chip bg-primary-container/15 text-primary-container">
          <Icon name="add" className="text-[15px]" /> 추천 미션
        </button>
      </div>

      {mine.length === 0 ? (
        <p className="text-[13px] text-on-surface-variant py-1">아직 미션이 없어요. '추천 미션'으로 추가하세요.</p>
      ) : (
        <ul className="space-y-2">
          {mine.map((m) => {
            const meta = MISSION_TYPE_META[m.type];
            return (
              <li key={m.id} className="rounded-md bg-surface-container-low p-2.5">
                <div className="flex items-start gap-2">
                  <Icon name={meta.icon} className="text-emerald text-[18px] mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[14px] leading-snug">{m.title}</p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">
                      {meta.label} · {m.points}점{m.safe ? ' · 🛡 안전형' : ''}
                    </p>
                  </div>
                  <button onClick={() => db.missions.delete(m.id!)} className="text-outline"><Icon name="close" className="text-[16px]" /></button>
                </div>
                {/* per-group completion toggles */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {groups.map((g) => {
                    const done = isDone(m.id!, g.id!);
                    return (
                      <button
                        key={g.id}
                        onClick={() => toggleResult(tripId, m.id!, g.id!)}
                        className={`chip ${done ? 'bg-emerald text-white' : 'bg-surface-variant text-on-surface-variant'}`}
                      >
                        {done && <Icon name="check" className="text-[14px]" />} {g.name}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pick && (
        <RecoSheet
          title={title}
          recos={recos}
          existingTitles={new Set(mine.map((m) => m.title))}
          onAdd={(t) => db.missions.add({ tripId, placeId, title: t.title, type: t.type, points: t.points, safe: t.safe })}
          onClose={() => setPick(false)}
        />
      )}
    </section>
  );
}

function RecoSheet({ title, recos, existingTitles, onAdd, onClose }: {
  title: string; recos: MissionTemplate[]; existingTitles: Set<string>;
  onAdd: (t: MissionTemplate) => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[520px] bg-surface rounded-t-2xl p-4 pb-8 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-head font-bold text-[18px]">추천 미션 · {title}</h2>
          <button onClick={onClose} className="text-outline"><Icon name="close" /></button>
        </div>
        <p className="text-[11px] text-on-surface-variant mb-3">장소 성격에 맞춰 자동 추천됐어요. 탭해서 추가하세요.</p>
        <ul className="overflow-y-auto space-y-2">
          {recos.map((t, i) => {
            const added = existingTitles.has(t.title);
            const meta = MISSION_TYPE_META[t.type];
            return (
              <li key={i}>
                <button disabled={added} onClick={() => onAdd(t)}
                  className={`w-full text-left rounded-md border p-3 flex items-start gap-2 ${added ? 'opacity-50 border-outline-variant/40' : 'border-primary-container/40 active:bg-primary-container/5'}`}>
                  <Icon name={meta.icon} className="text-emerald text-[20px] mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-[14px]">{t.title}</p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">{meta.label} · {t.points}점{t.safe ? ' · 🛡 안전형' : ''}</p>
                    {t.note && <p className="text-[11px] text-emerald mt-0.5">{t.note}</p>}
                  </div>
                  <Icon name={added ? 'check_circle' : 'add_circle'} className={added ? 'text-emerald' : 'text-primary-container'} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function AdminSheet({ tripId, groups, adjustments, firstId, lastId, onClose }: {
  tripId: number; groups: Group[]; adjustments: Adjustment[];
  firstId?: number; lastId?: number; onClose: () => void;
}) {
  const [groupId, setGroupId] = useState<number | ''>(groups[0]?.id ?? '');
  const [delta, setDelta] = useState(10);
  const [reason, setReason] = useState('');

  async function give(sign: 1 | -1) {
    if (groupId === '') return;
    await db.adjustments.add({ tripId, groupId: Number(groupId), delta: sign * Math.abs(delta), reason: reason.trim(), ts: Date.now() });
    setReason('');
  }
  const recent = [...adjustments].sort((a, b) => b.ts - a.ts).slice(0, 6);
  const nameOf = (gid: number) => groups.find((g) => g.id === gid)?.name ?? '?';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[520px] bg-surface rounded-t-2xl p-4 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-head font-bold text-[18px] flex items-center gap-1">
            <Icon name="admin_panel_settings" className="text-primary-container" /> 관리자 상벌점
          </h2>
          <button onClick={onClose} className="text-outline"><Icon name="close" /></button>
        </div>

        <label className="field-label">모둠</label>
        <select className="input mb-3" value={groupId} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : '')}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}{g.id === firstId ? ' 🥇' : ''}{g.id === lastId ? ' 🐢' : ''}
            </option>
          ))}
        </select>

        <div className="flex gap-2 items-end mb-3">
          <div className="flex-1">
            <label className="field-label">점수</label>
            <input type="number" className="input" value={delta} min={1}
              onChange={(e) => setDelta(Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div className="flex-[2]">
            <label className="field-label">사유 (선택)</label>
            <input className="input" placeholder="예: 질서 잘 지킴 / 지각" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button onClick={() => give(1)} className="btn-primary flex items-center justify-center gap-1"><Icon name="add" /> 가점</button>
          <button onClick={() => give(-1)} className="rounded-md px-4 py-3 font-semibold bg-error/10 text-error flex items-center justify-center gap-1"><Icon name="remove" /> 감점</button>
        </div>

        {recent.length > 0 && (
          <div>
            <p className="field-label">최근 부여</p>
            <ul className="space-y-1">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[13px] py-1 border-b border-outline-variant/20">
                  <span className="font-medium">{nameOf(a.groupId)}</span>
                  <span className={a.delta >= 0 ? 'text-emerald font-bold' : 'text-error font-bold'}>{a.delta >= 0 ? '+' : ''}{a.delta}</span>
                  <span className="text-on-surface-variant flex-1 truncate">{a.reason}</span>
                  <button onClick={() => db.adjustments.delete(a.id!)} className="text-outline"><Icon name="undo" className="text-[16px]" /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
