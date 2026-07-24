import { Screen } from '../../ui';
import type { ShareSnapshot } from '../../share';

export default function GalleryTab(_props: { shareId: string; places: ShareSnapshot['places'] }) {
  return <Screen><p className="text-[14px] text-on-surface-variant py-8 text-center">갤러리 준비 중…</p></Screen>;
}
