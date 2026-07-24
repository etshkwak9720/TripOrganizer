import { MISSION_TYPE_META } from '../../db';
import { computeRanking } from '../../share';
import { Icon, Screen, EmptyState } from '../../ui';
import type { ShareSnapshot } from '../../share';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function MissionTab({ schedule }: { schedule: ShareSnapshot }) {
  const { groups, missions, missionResults, adjustments, awards, places } = schedule;

  if (groups.length === 0) {
    return (
      <Screen>
        <EmptyState icon="diversity_3" title="모둠이 없어요" hint="인솔자가 모둠을 만들면 랭킹이 표시됩니다" />
      </Screen>
    );
  }

  const ranked = computeRanking(
    groups.map((g) => ({ id: g.id, name: g.name })),
    missions.map((m) => ({ id: m.id, points: m.points })),
    missionResults,
    adjustments.map((a) => ({ groupId: a.groupId, delta: a.delta })),
  );
  const firstName = ranked[0]?.group.name;
  const lastName = ranked.length > 1 ? ranked[ranked.length - 1].group.name : undefined;
  const groupName = (gid: number) => groups.find((g) => g.id === gid)?.name ?? '?';
  const doneGroups = (missionId: number) =>
    missionResults.filter((r) => r.missionId === missionId && r.done).map((r) => r.groupId);

  const sections: { key: string; title: string; placeId: number | null }[] = [
    { key: 'common', title: '공통 미션', placeId: null },
    ...places.map((p) => ({ key: `p${p.id}`, title: p.name, placeId: p.id })),
  ];

  return (
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

      {/* awards */}
      {awards && (awards.firstGroupReward || awards.lastGroupPenalty) && (
        <section className="card p-4 mb-4">
          <h2 className="font-head font-bold text-[16px] mb-3 flex items-center gap-1">
            <Icon name="emoji_events" className="text-primary-container" /> 1등 상 · 꼴찌 벌
          </h2>
          {awards.firstGroupReward && (
            <p className="text-[14px] mb-1">🥇 {firstName && <span className="text-primary-container font-semibold">{firstName}</span>} — {awards.firstGroupReward}</p>
          )}
          {awards.lastGroupPenalty && (
            <p className="text-[14px]">🐢 {lastName && <span className="text-error font-semibold">{lastName}</span>} — {awards.lastGroupPenalty}</p>
          )}
        </section>
      )}

      {/* missions by place */}
      <h2 className="font-head font-bold text-[16px] mt-1 mb-2">장소별 미션</h2>
      {sections.map((sec) => {
        const mine = missions.filter((m) => (m.placeId ?? null) === sec.placeId);
        if (mine.length === 0) return null;
        return (
          <section key={sec.key} className="card p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <Icon name={sec.placeId === null ? 'public' : 'place'} className="text-primary-container text-[20px]" />
              <span className="font-head font-bold">{sec.title}</span>
            </div>
            <ul className="space-y-2">
              {mine.map((m) => {
                const meta = MISSION_TYPE_META[m.type];
                const done = doneGroups(m.id);
                return (
                  <li key={m.id} className="rounded-md bg-surface-container-low p-2.5">
                    <div className="flex items-start gap-2">
                      <Icon name={meta.icon} className="text-emerald text-[18px] mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-[14px] leading-snug">{m.title}</p>
                        <p className="text-[11px] text-on-surface-variant mt-0.5">{meta.label} · {m.points}점{m.safe ? ' · 🛡 안전형' : ''}</p>
                      </div>
                    </div>
                    {done.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {done.map((gid) => (
                          <span key={gid} className="chip bg-emerald text-white">
                            <Icon name="check" className="text-[14px]" /> {groupName(gid)}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Screen>
  );
}
