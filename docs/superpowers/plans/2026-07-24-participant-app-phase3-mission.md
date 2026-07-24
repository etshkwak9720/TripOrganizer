# 참가자 앱 3단계 — 미션 탭 (읽기 전용 랭킹) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자 화면의 "미션" 자리표시자를 실제 읽기 전용 미션 탭으로 대체한다 — 실시간 모둠 랭킹 + 1등상/꼴찌벌 + 장소별 미션 목록(어느 모둠이 완료했는지).

**Architecture:** 스냅샷(groups·missions·missionResults·adjustments·awards)과 공용 `computeRanking`으로 렌더한다. 완료 토글·관리자 상벌점 UI는 없다(읽기 전용). 인솔자가 바꾸면 1·2단계의 자동 재발행+자동 새로고침으로 반영된다.

**Tech Stack:** 기존 Vite/React, `computeRanking`(1단계), `MISSION_TYPE_META`(`src/db.ts`).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-24-participant-full-app-design.md`
- 읽기 전용 — 미션 완료 토글, 관리자 상벌점, awards 편집 UI 없음.
- 데이터는 스냅샷에서만(로컬 Dexie 접근 금지).

---

### Task 1: 미션 탭 컴포넌트 + 연결

**Files:**
- Create: `src/pages/join/MissionTab.tsx`
- Modify: `src/pages/Join.tsx`
- Modify: `scripts/smoke-join.mjs`

**Interfaces:**
- Consumes: `computeRanking`(`src/share`), `MISSION_TYPE_META`(`src/db`), `ShareSnapshot`
- Produces: `MissionTab({ schedule })`

- [ ] **Step 1: `MissionTab` 작성**

Create `src/pages/join/MissionTab.tsx`:

```tsx
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
```

- [ ] **Step 2: `Join.tsx`에서 자리표시자 대체**

`src/pages/Join.tsx` 상단 import에 추가:

```tsx
import MissionTab from './join/MissionTab';
```

`{tab === 'mission' && <ComingSoon label="미션·랭킹은 곧 제공됩니다" icon="flag" />}` 를 아래로 교체:

```tsx
        {tab === 'mission' && <MissionTab schedule={schedule} />}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 통과. (`leaderboard`·`public`·`check`·`diversity_3`·`emoji_events`는
인솔자 화면에서 이미 서브셋에 포함 — 아이콘 재생성 불필요. 빌드 후 스모크에서 확인.)

- [ ] **Step 4: 스모크에 미션 탭 검증 추가**

`scripts/smoke-join.mjs`의 `snapshot`에 모둠·미션·결과·상벌점을 채운다:

```js
const snapshot = {
  trip: { title: '스모크 참여여행', startDate: '2026-09-14', dayCount: 2, mode: 'game' },
  members: [],
  groups: [{ id: 1, name: 'A조' }, { id: 2, name: 'B조' }],
  places: [{ id: 1, name: '성산일출봉', region: '제주', kind: 'sight', lat: 33.4, lng: 126.9 }],
  slots: [{ dayIndex: 0, band: '오전', plannedTime: '09:00', order: 0, placeId: 1, activityText: '' }],
  missions: [{ id: 10, placeId: 1, title: '단체 사진 찍기', type: 'photo', points: 5, safe: true }],
  missionResults: [{ missionId: 10, groupId: 1, done: true }],
  adjustments: [{ groupId: 2, delta: 3, reason: '', ts: 1 }],
  awards: { firstGroupReward: '간식 쏘기', lastGroupPenalty: '' },
};
```

그리고 "지금 탭 자리표시자" 확인 앞에 미션 탭 검증을 추가:

```js
await page.getByRole('button', { name: '미션' }).click();
await page.waitForTimeout(300);
const missionText = await page.locator('main').innerText();
check('미션 탭: 랭킹 표시', missionText.includes('실시간 모둠 랭킹') && missionText.includes('A조'));
check('미션 탭: 장소별 미션 표시', missionText.includes('단체 사진 찍기'));
check('미션 탭: 읽기전용(관리자 버튼 없음)', (await page.getByRole('button', { name: '관리자' }).count()) === 0);
```

주의: `snapshot`이 game 모드이므로 미션 탭 노출됨. 기존 "입장 후 일정 탭에 장소 표시" 등 다른 체크는 그대로 통과한다(장소 성산일출봉 유지).

- [ ] **Step 5: 실행해서 통과 확인**

Run: (터미널1) `npm run dev`, (터미널2) `npm run test:join`
Expected: 미션 체크 3개 포함 전부 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/join/MissionTab.tsx src/pages/Join.tsx scripts/smoke-join.mjs
git commit -m "feat: participant mission tab (read-only ranking, awards, missions by place)"
```

---

### Task 2: 배포 검증

- [ ] **Step 1: 빌드 + 회귀 스모크**

Run: `npm run build`
Run: (터미널1) `npm run dev`, (터미널2) `npm run test:join` 및 `npm run test:share:ui` → PASS.

- [ ] **Step 2: 배포 + 별칭**

```bash
npx vercel --prod --yes
```
배포 후 최신 배포를 `triporganizer-app.vercel.app`로 alias(기존 방식).

- [ ] **Step 3: 실기기/브라우저 확인**

게임 모드 여행을 공유한 뒤 `https://triporganizer-app.vercel.app/join/<shareId>` 미션 탭에서
랭킹·상벌·장소별 미션이 보이는지, 인솔자가 점수를 바꾸면 ~20초 내 반영되는지 확인.
(서비스워커 캐시 주의 — 새로고침 필요할 수 있음)

---

## Self-Review Notes

- **스펙 커버리지(3단계)**: C-미션(실시간 랭킹 + 상/벌 + 장소별 미션, 읽기 전용) = Task 1. 자동 반영은
  1·2단계(자동 재발행 + 자동 새로고침)에 의존.
- **타입 일관성**: `computeRanking` 인자 형태가 1단계 정의와 일치. `MISSION_TYPE_META[m.type]`는
  `schedule.missions[].type`(= `MissionType`)와 일치.
- **읽기 전용 확인**: 토글·관리자·awards 편집 없음(Task 1 Step 4 스모크가 관리자 버튼 부재 검증).
- **플레이스홀더 없음**: 실제 코드/명령 포함.
