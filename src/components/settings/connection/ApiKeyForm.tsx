import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff } from 'lucide-react';
import { t } from '@/lib/i18n';

interface ApiKeyFormProps {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  showApiKey: boolean;
  onShowApiKeyChange: (show: boolean) => void;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  showBaseUrl: boolean;
  showApiKeyField: boolean;
  placeholderUrl: string;
  isOpenAICompatible: boolean;
}

export function ApiKeyForm({
  apiKey,
  onApiKeyChange,
  showApiKey,
  onShowApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  showBaseUrl,
  showApiKeyField,
  placeholderUrl,
  isOpenAICompatible,
}: ApiKeyFormProps) {
  return (
    <>
      {/* Base URL */}
      {showBaseUrl && (
        <div className="space-y-1.5">
          <Label className="text-sm">
            Base URL
            {isOpenAICompatible && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Input
            type="url"
            placeholder={placeholderUrl || 'https://api.example.com'}
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            className="w-full"
          />
        </div>
      )}

      {/* API Key */}
      {showApiKeyField && (
        <div className="space-y-1.5">
          <Label className="text-sm">{t("conn.apiKey")}</Label>
          <div className="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              className="w-full pr-10"
            />
            <Button
              type="button" variant="ghost" size="icon"
              className="absolute right-0 top-0 h-full w-10 text-muted-foreground hover:text-foreground"
              onClick={() => onShowApiKeyChange(!showApiKey)}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" strokeWidth={1.5} /> : <Eye className="h-4 w-4" strokeWidth={1.5} />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
