import type { ReactNode } from 'react';
import ViewportTooltip from '../ViewportTooltip';

export default function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  if (!visible) return null
  return <ViewportTooltip visible className="z-10 whitespace-nowrap">{text}</ViewportTooltip>
}
