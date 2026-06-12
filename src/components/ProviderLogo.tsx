import { Cpu, Server, Terminal } from 'lucide-react';

export const PROVIDER_LOGOS: Record<string, string | null> = {
  anthropic: '/logos/anthropic.svg',
  openai: '/logos/openai.svg',
  ollama: '/logos/ollama-official.png',
  github: '/logos/copilot.svg',
  google: '/logos/google.svg',
  openai_compatible: null, // Uses Server icon instead
  local_ai: null, // Uses Cpu icon instead
  custom_acp: null, // Uses Terminal icon instead
};

/**
 * `bare = true`: render the logo without the white background + padding chrome
 * that keeps dark-on-dark logos legible. Use when the parent provides its own
 * visual containment (e.g. a bordered footer pill) so we don't end up with a
 * solid white square in dark mode.
 */
export function ProviderLogo({ provider, className = 'w-6 h-6', bare = false }: { provider: string; className?: string; bare?: boolean }) {
  if (provider === 'local_ai') {
    return (
      <span className={`${className} rounded ${bare ? '' : 'bg-muted'} flex items-center justify-center`}>
        <Cpu className="w-[70%] h-[70%] text-foreground" strokeWidth={1.5} />
      </span>
    );
  }

  if (provider === 'openai_compatible') {
    return (
      <span className={`${className} rounded ${bare ? '' : 'bg-muted'} flex items-center justify-center`}>
        <Server className="w-[70%] h-[70%] text-foreground" strokeWidth={1.5} />
      </span>
    );
  }

  if (provider === 'custom_acp') {
    return (
      <span className={`${className} rounded ${bare ? '' : 'bg-muted'} flex items-center justify-center`}>
        <Terminal className="w-[70%] h-[70%] text-foreground" strokeWidth={1.5} />
      </span>
    );
  }

  const src = PROVIDER_LOGOS[provider];

  if (!src) {
    return <span className={`${className} rounded bg-muted`} />;
  }

  // In bare mode we force monochrome logos to black (`brightness-0`) so the
  // visual is theme-independent of whatever fill the SVG shipped with —
  // several bundled logos (Anthropic, Copilot) use hardcoded `fill="#000000"`,
  // others (OpenAI) use `currentColor`, so relying on the source fill alone
  // led to inverted/invisible results in some themes. `dark:invert` then
  // flips black → white for dark mode. Google's logo is colorful by design
  // (the rainbow "G") and we preserve those brand colors by skipping the
  // filter.
  const isColorful = provider === 'google';
  return (
    <img
      src={src}
      alt={provider}
      className={`${className} rounded object-contain ${
        bare
          ? (isColorful ? '' : 'brightness-0 dark:invert')
          : 'bg-white p-0.5'
      }`}
    />
  );
}
