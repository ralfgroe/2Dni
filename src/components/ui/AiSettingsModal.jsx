import { useState } from 'react';
import { useAiStore } from '../../store/aiStore';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'ollama', label: 'Ollama (Local)' },
  { id: 'custom', label: 'Custom Endpoint' },
];

export default function AiSettingsModal({ onClose }) {
  const { provider, endpoint, apiKey, model, setProvider, setEndpoint, setApiKey, setModel } = useAiStore();

  const [localProvider, setLocalProvider] = useState(provider);
  const [localEndpoint, setLocalEndpoint] = useState(endpoint);
  const [localApiKey, setLocalApiKey] = useState(apiKey);
  const [localModel, setLocalModel] = useState(model);

  const handleProviderChange = (p) => {
    setLocalProvider(p);
    const presets = {
      openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
      anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514' },
      ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3' },
    };
    if (presets[p]) {
      setLocalEndpoint(presets[p].endpoint);
      setLocalModel(presets[p].model);
    }
  };

  const handleSave = () => {
    setProvider(localProvider);
    setEndpoint(localEndpoint);
    setApiKey(localApiKey);
    setModel(localModel);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-96 rounded-lg border border-border-primary bg-bg-secondary shadow-xl"
        style={{ padding: '24px 32px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border-primary" style={{ paddingBottom: '16px' }}>
          <h3 className="text-sm font-semibold text-text-primary">AI Model Settings</h3>
          <p className="mt-0.5 text-[10px] text-text-muted">
            Configure the AI model for the Code Wrangle assistant
          </p>
        </div>

        <div className="flex flex-col gap-4" style={{ paddingTop: '20px', paddingBottom: '20px' }}>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-text-secondary">Provider</label>
            <div className="grid grid-cols-2 gap-1.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id)}
                  className={`rounded border text-[11px] transition-colors ${
                    localProvider === p.id
                      ? 'border-accent bg-accent/10 text-accent font-medium'
                      : 'border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-tertiary'
                  }`}
                  style={{ padding: '8px 20px' }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {localProvider !== 'ollama' && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-text-secondary">API Key</label>
              <input
                type="password"
                value={localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                placeholder={localProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                className="rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-text-secondary">Model</label>
            <input
              type="text"
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
              placeholder="e.g. gpt-4o-mini"
              className="rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-text-secondary">Endpoint</label>
            <input
              type="text"
              value={localEndpoint}
              onChange={(e) => setLocalEndpoint(e.target.value)}
              className="rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-[11px] font-mono text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
            />
            {localProvider === 'ollama' && (
              <span className="text-[9px] text-text-muted">
                Make sure Ollama is running locally
              </span>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border-primary" style={{ paddingTop: '16px' }}>
          <button
            onClick={onClose}
            className="rounded border border-border-primary bg-bg-primary text-[11px] text-text-secondary hover:bg-bg-tertiary"
            style={{ padding: '8px 20px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded bg-accent text-[11px] font-medium text-white hover:bg-accent-hover"
            style={{ padding: '8px 20px' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
