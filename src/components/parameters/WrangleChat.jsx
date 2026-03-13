import { useState, useRef, useEffect, useCallback } from 'react';
import { useAiStore } from '../../store/aiStore';
import { useGraphStore } from '../../store/graphStore';
import { generateCode } from '../../utils/aiService';

export default function WrangleChat({ nodeId, inputGeometry, currentCode }) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const chatEndRef = useRef(null);

  const isConfigured = useAiStore((s) => s.isConfigured);
  const getChatHistory = useAiStore((s) => s.getChatHistory);
  const addMessage = useAiStore((s) => s.addMessage);
  const clearChatHistory = useAiStore((s) => s.clearChatHistory);
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);

  const history = getChatHistory(nodeId);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  const handleSend = useCallback(async () => {
    if (!message.trim() || loading) return;

    const userMsg = message.trim();
    setMessage('');
    setError(null);

    addMessage(nodeId, 'user', userMsg);

    setLoading(true);
    try {
      const code = await generateCode(userMsg, inputGeometry, getChatHistory(nodeId));
      addMessage(nodeId, 'assistant', code);
      updateNodeParams(nodeId, { code });
    } catch (e) {
      setError(e.message);
      addMessage(nodeId, 'assistant', `Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [message, loading, nodeId, inputGeometry, addMessage, getChatHistory, updateNodeParams]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    }
  };

  if (!isConfigured()) {
    return (
      <div className="flex flex-col gap-2 rounded border border-border-primary bg-bg-primary p-3">
        <span className="text-[11px] font-medium text-text-secondary">AI Assistant</span>
        <p className="text-[10px] text-text-muted">
          Configure your AI model in the toolbar settings (AI icon) to use the chat assistant.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-text-secondary">AI Assistant</span>
        {history.length > 0 && (
          <button
            onClick={() => clearChatHistory(nodeId)}
            className="text-[9px] text-text-muted hover:text-text-secondary"
          >
            Clear
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div
          className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded border border-border-primary bg-bg-primary p-2"
        >
          {history.map((msg, i) => (
            <div
              key={i}
              className={`rounded px-2 py-1.5 text-[10px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-accent/10 text-text-primary'
                  : msg.content.startsWith('Error:')
                    ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                    : 'bg-bg-tertiary text-text-secondary font-mono'
              }`}
            >
              {msg.role === 'user' ? (
                <span>{msg.content}</span>
              ) : msg.content.startsWith('Error:') ? (
                <span>{msg.content}</span>
              ) : (
                <pre className="whitespace-pre-wrap break-words">{msg.content}</pre>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-muted">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Generating code...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      <div className="flex gap-1.5">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want..."
          rows={2}
          className="flex-1 resize-none rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
        />
        <button
          onClick={handleSend}
          disabled={loading || !message.trim()}
          className="self-end rounded bg-accent text-[10px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          style={{ padding: '8px 20px' }}
        >
          {loading ? '...' : 'Send'}
        </button>
      </div>

      {error && (
        <p className="text-[9px] text-red-500">{error}</p>
      )}
    </div>
  );
}
