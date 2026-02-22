export const PROVIDER_LOGOS: Record<string, string | null> = {
  anthropic: '/logos/anthropic.svg',
  openai: '/logos/openai.svg',
  ollama: '/logos/ollama-official.png',
  github: '/logos/copilot.svg',
  google: '/logos/google.svg',
};

export function ProviderLogo({ provider, className = 'w-6 h-6' }: { provider: string; className?: string }) {
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
