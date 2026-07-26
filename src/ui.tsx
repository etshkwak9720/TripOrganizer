import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export function Icon({ name, className = '', fill }: { name: string; className?: string; fill?: boolean }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={fill ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}

export function TopBar({ title, back, backTo, right, onEditTitle }: {
  title: string;
  back?: boolean;
  backTo?: string;
  right?: ReactNode;
  onEditTitle?: () => void; // shows a pencil beside the title when provided
}) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 h-14 px-3 bg-surface/90 backdrop-blur border-b border-outline-variant/30">
      {back && (
        <button aria-label="뒤로" onClick={() => nav(-1)} className="p-1 -ml-1 text-on-surface hover:bg-surface-variant/50 rounded-full w-8 h-8 grid place-items-center transition">
          <Icon name="arrow_back_ios_new" className="text-[18px]" />
        </button>
      )}
      {!back && backTo && (
        <button aria-label="여행 목록" onClick={() => nav(backTo)} className="p-1 -ml-1 text-on-surface hover:bg-surface-variant/50 rounded-full w-8 h-8 grid place-items-center transition">
          <Icon name="home" className="text-[22px]" />
        </button>
      )}
      <h1 className="font-head font-bold text-[18px] text-on-surface truncate flex-1">{title}</h1>
      {onEditTitle && (
        <button aria-label="여행 이름 수정" onClick={onEditTitle} className="p-1 text-outline hover:text-primary-container hover:bg-primary-container/10 rounded-full w-8 h-8 grid place-items-center active:scale-95 transition shrink-0">
          <Icon name="edit" className="text-[18px]" />
        </button>
      )}
      {right}
    </header>
  );
}

export function Screen({ children, pad = true }: { children: ReactNode; pad?: boolean }) {
  return <main className={`pb-24 ${pad ? 'px-4 pt-4' : ''}`}>{children}</main>;
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 text-on-surface-variant">
      <Icon name={icon} className="text-[48px] text-outline mb-2" />
      <p className="font-semibold text-on-surface">{title}</p>
      {hint && <p className="text-[13px] mt-1">{hint}</p>}
    </div>
  );
}

export function Stepper({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5 px-4 py-3">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-primary-container' : 'bg-surface-variant'}`}
        />
      ))}
    </div>
  );
}
