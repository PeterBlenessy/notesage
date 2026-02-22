import { Github } from 'lucide-react';

export const PROVIDER_LOGOS: Record<string, string | null> = {
  anthropic: '/logos/anthropic.svg',
  openai: '/logos/openai.svg',
  ollama: '/logos/ollama-official.png',
  github: null, // Uses lucide icon fallback
  google: '/logos/google.svg',
};

export function ProviderLogo({ provider, className = 'w-6 h-6' }: { provider: string; className?: string }) {
  const src = PROVIDER_LOGOS[provider];

  if (!src) {
    if (provider === 'github') {
      return (
        <span className={`${className} rounded flex items-center justify-center bg-white p-0.5`}>
          <Github className="w-full h-full text-black" strokeWidth={1.5} />
        </span>
      );
    }
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
