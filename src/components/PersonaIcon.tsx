import {
  UserRound,
  UserRoundPen,
  LineSquiggle,
  UserRoundSearch,
  UserRoundCheck,
  Sparkles,
  GraduationCap,
  Megaphone,
} from 'lucide-react';
import type { AIPersona } from '@/stores/ai-store';
import type { LucideIcon } from 'lucide-react';

/** Built-in personas that map to a single lucide icon (no composite needed). */
const DIRECT_ICONS: Record<string, LucideIcon> = {
  technical: UserRoundPen,
  'fact-checker': UserRoundSearch,
  proofreader: UserRoundCheck,
};

/** Built-in personas rendered as UserRound + a smaller badge icon. */
const COMPOSITE_ICONS: Record<string, LucideIcon> = {
  general: Sparkles,
  creative: LineSquiggle,
  academic: GraduationCap,
  copywriter: Megaphone,
};

interface PersonaIconProps {
  persona: AIPersona;
  size?: number;
  className?: string;
}

export function PersonaIcon({ persona, size = 16, className }: PersonaIconProps) {
  // Custom (non-built-in) personas: render their emoji
  if (!persona.builtIn) {
    return (
      <span
        className={className}
        style={{ fontSize: size * 0.85, lineHeight: 1 }}
      >
        {persona.icon}
      </span>
    );
  }

  // Direct single-icon mapping
  const DirectIcon = DIRECT_ICONS[persona.id];
  if (DirectIcon) {
    return (
      <DirectIcon
        className={className}
        style={{ width: size, height: size }}
        strokeWidth={1.5}
      />
    );
  }

  // Composite: UserRound base + badge in bottom-right
  const BadgeIcon = COMPOSITE_ICONS[persona.id];
  if (BadgeIcon) {
    const badgeSize = Math.round(size * 0.5);
    return (
      <span
        className={className}
        style={{
          position: 'relative',
          display: 'inline-flex',
          width: size,
          height: size,
        }}
      >
        <UserRound
          style={{ width: size, height: size }}
          strokeWidth={1.5}
        />
        <span
          style={{
            position: 'absolute',
            bottom: -1,
            right: -2,
            width: badgeSize + 2,
            height: badgeSize + 2,
            borderRadius: '50%',
            backgroundColor: 'var(--color-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BadgeIcon
            style={{ width: badgeSize, height: badgeSize }}
            strokeWidth={2}
          />
        </span>
      </span>
    );
  }

  // Fallback for any unrecognized built-in persona
  return (
    <UserRound
      className={className}
      style={{ width: size, height: size }}
      strokeWidth={1.5}
    />
  );
}
