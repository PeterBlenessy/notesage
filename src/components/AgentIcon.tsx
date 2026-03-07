import { type LucideIcon, UserRound, Sparkles, PenTool, Settings, Search, GraduationCap, Megaphone, SpellCheck, PenLine, Star, Bot, Wand2, BookOpen, Code, FileText, Lightbulb, MessageSquare, Pencil, Target, Zap } from 'lucide-react';

/** Map of Lucide icon names to their components. Only includes icons used by bundled/common agents. */
const ICON_MAP: Record<string, LucideIcon> = {
  'user-round': UserRound,
  'sparkles': Sparkles,
  'pen-tool': PenTool,
  'pen-line': PenLine,
  'settings': Settings,
  'search': Search,
  'graduation-cap': GraduationCap,
  'megaphone': Megaphone,
  'spell-check': SpellCheck,
  'star': Star,
  'bot': Bot,
  'wand-2': Wand2,
  'book-open': BookOpen,
  'code': Code,
  'file-text': FileText,
  'lightbulb': Lightbulb,
  'message-square': MessageSquare,
  'pencil': Pencil,
  'target': Target,
  'zap': Zap,
};

interface AgentIconProps {
  icon?: string;
  size?: number;
  className?: string;
}

/** Renders an agent icon from a Lucide icon name or emoji. Falls back to UserRound. */
export function AgentIcon({ icon, size = 16, className }: AgentIconProps) {
  if (!icon) {
    return <UserRound className={className} style={{ width: size, height: size }} strokeWidth={1.5} />;
  }

  // Check if it's an emoji (non-ASCII first character)
  if (/^\p{Emoji}/u.test(icon)) {
    return (
      <span className={className} style={{ fontSize: size * 0.85, lineHeight: 1 }}>
        {icon}
      </span>
    );
  }

  // Look up Lucide icon by name
  const IconComponent = ICON_MAP[icon];
  if (IconComponent) {
    return <IconComponent className={className} style={{ width: size, height: size }} strokeWidth={1.5} />;
  }

  // Fallback
  return <UserRound className={className} style={{ width: size, height: size }} strokeWidth={1.5} />;
}
