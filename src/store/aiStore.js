import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAiStore = create(
  persist(
    (set, get) => ({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      model: 'gpt-4o-mini',

      chatHistories: {},

      setProvider: (provider) => {
        const presets = {
          openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
          anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514' },
          ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3' },
          custom: { endpoint: get().endpoint, model: get().model },
        };
        const preset = presets[provider] || presets.custom;
        set({ provider, endpoint: preset.endpoint, model: preset.model });
      },
      setEndpoint: (endpoint) => set({ endpoint }),
      setApiKey: (apiKey) => set({ apiKey }),
      setModel: (model) => set({ model }),

      getChatHistory: (nodeId) => get().chatHistories[nodeId] || [],

      addMessage: (nodeId, role, content) => {
        const histories = { ...get().chatHistories };
        if (!histories[nodeId]) histories[nodeId] = [];
        histories[nodeId] = [...histories[nodeId], { role, content, timestamp: Date.now() }];
        set({ chatHistories: histories });
      },

      clearChatHistory: (nodeId) => {
        const histories = { ...get().chatHistories };
        delete histories[nodeId];
        set({ chatHistories: histories });
      },

      isConfigured: () => {
        const { provider, apiKey, endpoint } = get();
        if (provider === 'ollama') return !!endpoint;
        return !!apiKey && !!endpoint;
      },
    }),
    {
      name: '2dni-ai-settings',
      partialize: (state) => ({
        provider: state.provider,
        endpoint: state.endpoint,
        apiKey: state.apiKey,
        model: state.model,
      }),
    }
  )
);
