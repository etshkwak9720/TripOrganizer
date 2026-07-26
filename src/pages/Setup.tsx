import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Icon, TopBar, Screen, EmptyState } from '../ui';
import PlacePicker from '../components/PlacePicker';
import RenameTripDialog from '../components/RenameTripDialog';

type Tab = 'members' | 'groups' | 'places';

export default function Setup() {
  const { id } = useParams();
  const tripId = Number(id);
  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const [tab, setTab] = useState<Tab>('members');
  const [renaming, setRenaming] = useState(false);

  if (!trip) return <Screen><EmptyState icon="error" title="여행을 찾을 수 없어요" /></Screen>;

  return (
    <>
      <TopBar
        title={trip.title}
        backTo="/"
        onEditTitle={() => setRenaming(true)}
        right={
          <Link to={`/trip/${tripId}/schedule`} className="text-primary-container font-semibold text-[14px] flex items-center gap-0.5">
            일정짜기 <Icon name="chevron_right" className="text-[18px]" />
          </Link>
        }
      />
      <div className="flex gap-1 px-4 pt-3">
        {([['members', '구성원', 'person'], ['groups', '모둠', 'diversity_3'], ['places', '장소', 'place']] as const).map(
          ([k, label, icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-md text-[14px] font-semibold ${
                tab === k ? 'bg-primary-container/15 text-primary-container' : 'text-tertiary'
              }`}
            >
              <Icon name={icon} className="text-[18px]" /> {label}
            </button>
          ),
        )}
      </div>

      <Screen>
        {tab === 'members' && <Members tripId={tripId} />}
        {tab === 'groups' && <Groups tripId={tripId} />}
        {tab === 'places' && <Places tripId={tripId} />}
      </Screen>

      {renaming && (
        <RenameTripDialog tripId={tripId} current={trip.title} onClose={() => setRenaming(false)} />
      )}
    </>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="flex gap-2 mb-3">
      <input
        className="input"
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); }
        }}
      />
      <button
        className="btn-primary px-4 shrink-0"
        onClick={() => { if (v.trim()) { onAdd(v.trim()); setV(''); } }}
      >
        <Icon name="add" />
      </button>
    </div>
  );
}

function Members({ tripId }: { tripId: number }) {
  const members = useLiveQuery(() => db.members.where('tripId').equals(tripId).toArray(), [tripId]);
  const groups = useLiveQuery(() => db.groups.where('tripId').equals(tripId).toArray(), [tripId]);
  return (
    <div>
      <AddRow placeholder="구성원 이름 입력 후 Enter" onAdd={(name) => db.members.add({ tripId, name, groupId: null })} />
      {members?.length === 0 && <EmptyState icon="person_add" title="구성원을 추가하세요" hint="함께 여행하는 사람들을 등록해요" />}
      <ul className="space-y-2">
        {members?.map((m) => (
          <li key={m.id} className="card p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald/10 grid place-items-center text-emerald font-bold">
              {m.name.slice(0, 1)}
            </div>
            <span className="flex-1 font-medium">{m.name}</span>
            <select
              className="text-[13px] rounded-md border-outline-variant py-1 pr-7"
              value={m.groupId ?? ''}
              onChange={(e) => db.members.update(m.id!, { groupId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">모둠 없음</option>
              {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button onClick={() => db.members.delete(m.id!)} className="text-outline"><Icon name="delete" className="text-[20px]" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Groups({ tripId }: { tripId: number }) {
  const groups = useLiveQuery(() => db.groups.where('tripId').equals(tripId).toArray(), [tripId]);
  const members = useLiveQuery(() => db.members.where('tripId').equals(tripId).toArray(), [tripId]);
  return (
    <div>
      <AddRow placeholder="모둠 이름 (예: 1모둠)" onAdd={(name) => db.groups.add({ tripId, name, score: 0 })} />
      {groups?.length === 0 && <EmptyState icon="diversity_3" title="모둠을 만들어요" hint="게임 모드에서 모둠별로 점수를 겨뤄요" />}
      <ul className="space-y-2">
        {groups?.map((g) => {
          const count = members?.filter((m) => m.groupId === g.id).length ?? 0;
          return (
            <li key={g.id} className="card p-3 flex items-center gap-3">
              <Icon name="diversity_3" className="text-emerald" />
              <span className="flex-1 font-medium">{g.name}</span>
              <span className="text-[13px] text-on-surface-variant">{count}명</span>
              <button onClick={() => db.groups.delete(g.id!)} className="text-outline"><Icon name="delete" className="text-[20px]" /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Places({ tripId }: { tripId: number }) {
  const places = useLiveQuery(() => db.places.where('tripId').equals(tripId).toArray(), [tripId]);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null); // placeId being re-pinned
  const editTarget = places?.find((p) => p.id === editing);

  return (
    <div>
      <button className="btn-primary w-full mb-3 flex items-center justify-center gap-1" onClick={() => setAdding(true)}>
        <Icon name="add_location_alt" /> 장소 추가 (지도 검색)
      </button>
      {places?.length === 0 && <EmptyState icon="add_location_alt" title="장소를 추가하세요" hint="일정에 넣을 방문지를 등록해요" />}
      <ul className="space-y-2">
        {places?.map((p) => (
          <li key={p.id} className="card p-3">
            <div className="flex items-center gap-3">
              <Icon name={p.kind === 'food' ? 'restaurant' : 'place'} className={p.kind === 'food' ? 'text-emerald' : 'text-primary-container'} />
              <div className="flex-1 min-w-0">
                <span className="font-medium block truncate">
                  {p.name}
                  {p.kind === 'food' && <span className="ml-1 text-[10px] text-emerald font-bold">식당</span>}
                </span>
                {p.lat != null && p.lng != null ? (
                  <span className="text-[10px] text-emerald font-semibold">📍 {p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span>
                ) : (
                  <button onClick={() => setEditing(p.id!)} className="text-[10px] text-error font-semibold">좌표 없음 — 지도에서 찾기</button>
                )}
              </div>
              <button onClick={() => setEditing(p.id!)} className="text-outline" aria-label="지도에서 찾기">
                <Icon name="edit_location_alt" className="text-[20px]" />
              </button>
              <button onClick={() => setOpen(open === p.id ? null : p.id!)} className="text-outline">
                <Icon name={open === p.id ? 'expand_less' : 'expand_more'} />
              </button>
              <button onClick={() => db.places.delete(p.id!)} className="text-outline"><Icon name="delete" className="text-[20px]" /></button>
            </div>
            {open === p.id && (
              <div className="mt-3 space-y-2 pl-8">
                {p.address && <p className="text-[11px] text-on-surface-variant">{p.address}</p>}
                <input className="input" placeholder="지역 (예: 서귀포시)" defaultValue={p.region}
                  onChange={(e) => db.places.update(p.id!, { region: e.target.value })} />
                <textarea className="input text-[13px]" rows={3} placeholder="장소 안내 — 의미·유래·문화유산 선정 이유·학습 콘텐츠"
                  defaultValue={p.learn ?? ''} onChange={(e) => db.places.update(p.id!, { learn: e.target.value })} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <PlacePicker
          title="장소 추가"
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            await db.places.add({
              tripId, name: v.name, region: '', kind: 'sight', address: v.address || undefined,
              ...(v.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng } : {}),
            });
            setAdding(false);
          }}
        />
      )}
      {editing != null && editTarget && (
        <PlacePicker
          title="위치 찾기"
          initialName={editTarget.name}
          initialLat={editTarget.lat}
          initialLng={editTarget.lng}
          initialAddress={editTarget.address}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            await db.places.update(editing, {
              name: v.name, address: v.address || undefined,
              ...(v.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng } : {}),
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
