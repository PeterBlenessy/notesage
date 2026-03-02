import { Server } from 'lucide-react';

export const PROVIDER_LOGOS: Record<string, string | null> = {
  anthropic: '/logos/anthropic.svg',
  openai: '/logos/openai.svg',
  ollama: '/logos/ollama-official.png',
  github: '/logos/copilot.svg',
  google: '/logos/google.svg',
  openai_compatible: null, // Uses Server icon instead
};

export function ProviderLogo({ provider, className = 'w-6 h-6' }: { provider: string; className?: string }) {
  if (provider === 'openai_compatible') {
    return (
      <span className={`${className} rounded bg-muted flex items-center justify-center`}>
        <Server className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.5} />
      </span>
    );
  }

  const src = PROVIDER_LOGOS[provider];

  if (!src) {
    return <span className={`${className} rounded bg-muted`} />;
  }

  return (
    <img
      src={src}
      alt={provider}
      className={`${className} rounded object-contain bg-white p-0.5`}
    />
  );
}
