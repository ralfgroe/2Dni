import { useState } from 'react';
import { saveProject, loadProject } from '../../utils/projectIO';
import AiSettingsModal from './AiSettingsModal';

export default function Toolbar() {
  const [showAiSettings, setShowAiSettings] = useState(false);

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border-primary bg-bg-secondary" style={{ height: '36px', paddingLeft: '16px', paddingRight: '40px' }}>
      <div className="flex items-center gap-3">
        <svg width="68" height="20" viewBox="224.5 404.55 162.77 44.9" xmlns="http://www.w3.org/2000/svg">
          <polygon fill="#e8bed9" points="224.5 404.55 224.5 415.77 258.17 415.77 258.17 421.39 224.5 421.39 224.5 432.61 224.5 449.45 230.11 449.45 235.72 449.45 269.4 449.45 269.4 438.23 235.72 438.23 235.72 432.61 269.4 432.61 269.4 421.39 269.4 415.77 269.4 404.55 258.17 404.55 224.5 404.55"/>
          <path fill="#e8bed9" d="M314.3,410.16h-5.61v-5.61h-33.68v44.9h33.68v-5.61h5.61v-5.61h5.61v-22.45h-5.61v-5.61ZM308.69,438.23h-22.45v-22.45h22.45v22.45Z"/>
          <polygon fill="#e8bed9" points="364.82 415.77 364.82 410.16 359.2 410.16 359.2 404.55 336.75 404.55 336.75 410.16 331.14 410.16 331.14 415.77 325.53 415.77 325.53 438.23 325.53 443.84 325.53 449.45 336.75 449.45 336.75 438.23 336.75 432.74 336.75 415.77 359.2 415.77 359.2 432.74 359.2 438.23 359.2 449.45 370.43 449.45 370.43 438.23 370.43 415.77 364.82 415.77"/>
          <polygon fill="#e8bed9" points="381.66 404.55 381.66 410.16 381.66 412.01 381.66 415.77 376.04 415.77 376.04 438.23 376.04 443.84 376.04 449.45 387.27 449.45 387.27 438.23 387.27 432.74 387.27 415.77 387.27 412.01 387.27 410.16 387.27 404.55 381.66 404.55"/>
        </svg>
        <div className="h-4 w-px bg-border-primary" />
        <ToolbarButton onClick={saveProject} title="Save project to JSON">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          Save
        </ToolbarButton>
        <ToolbarButton onClick={loadProject} title="Load project from JSON">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Load
        </ToolbarButton>
      </div>

      <div className="flex items-center gap-2">
        <ToolbarButton onClick={() => setShowAiSettings(true)} title="AI Model Settings">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.57-3.25 3.92L12 22" />
            <path d="M12 2a4 4 0 0 0-4 4c0 1.95 1.4 3.57 3.25 3.92" />
            <circle cx="12" cy="6" r="1" fill="currentColor" />
            <path d="M6 12h12" />
            <path d="M9 16h6" />
          </svg>
          AI
        </ToolbarButton>
      </div>

      {showAiSettings && <AiSettingsModal onClose={() => setShowAiSettings(false)} />}
    </div>
  );
}

function ToolbarButton({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center rounded border border-border-primary bg-bg-tertiary text-text-secondary transition-colors hover:bg-border-primary hover:text-text-primary"
      style={{ height: '22px', gap: '4px', padding: '0 6px', fontSize: '11px' }}
      title={title}
    >
      {children}
    </button>
  );
}
