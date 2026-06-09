import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { Cell } from '@jupyterlab/cells';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  skill?: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  name: string;
  result?: string;
}

interface PegasusMeta {
  agent: string;
  skill: string;
  messages: ChatMessage[];
}

// ─── App reference (set from index.ts) ────────────────────────────────────────

let _app: any = null;
export function setJupyterApp(app: any): void { _app = app; }

// ─── JupyterLab context (current file + selection, updated from index.ts) ─────

interface JupyterContext {
  filePath: string;       // e.g. "work/my_workflow.ipynb"
  notebookDir: string;    // relative dir to server root
  cellSource: string;     // full source of the active cell
  selection: string;      // currently selected text (DOM selection)
  notebookCells: string;  // all cell sources joined (full notebook)
  lastError: string;      // last error from a failed cell execution
}

let _jupyterCtx: JupyterContext = {
  filePath: '', notebookDir: '.', cellSource: '', selection: '',
  notebookCells: '', lastError: '',
};

export function setJupyterContext(ctx: Partial<JupyterContext>): void {
  _jupyterCtx = { ..._jupyterCtx, ...ctx };
}

export function getJupyterContext(): JupyterContext {
  // Always grab the live DOM selection
  return { ..._jupyterCtx, selection: window.getSelection()?.toString().trim() ?? '' };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function pageBase(): string {
  return (window as any).jupyterPageConfig?.getOption('baseUrl') ?? '/';
}

function apiBase(): string {
  return `${window.location.origin}${pageBase()}pegasus`;
}

function xsrfHeaders(): Record<string, string> {
  const match = document.cookie.match(/\b_xsrf=([^;]+)/);
  const token = match ? decodeURIComponent(match[1]) : '';
  return token ? { 'X-XSRFToken': token } : {};
}


async function fetchLLMConfig(): Promise<{ provider: string; model: string; base_url: string; providers: string[] }> {
  const resp = await fetch(`${apiBase()}/llm/config`);
  return resp.json();
}

async function saveLLMConfig(provider: string, model: string, apiKey: string, baseUrl: string): Promise<void> {
  await fetch(`${apiBase()}/llm/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...xsrfHeaders() },
    body: JSON.stringify({ provider, model, api_key: apiKey, base_url: baseUrl }),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isPegasusCell(cell: Cell): boolean {
  // JupyterLab 4 API
  try {
    const meta = (cell.model as any).getMetadata('pegasus');
    return meta != null;
  } catch {
    return false;
  }
}

function getMeta(cell: Cell): PegasusMeta {
  try {
    const meta = (cell.model as any).getMetadata('pegasus') as PegasusMeta | undefined;
    return meta ?? { agent: 'pegasus-workflow-architect', skill: 'scaffold', messages: [] };
  } catch {
    return { agent: 'pegasus-workflow-architect', skill: 'scaffold', messages: [] };
  }
}

function saveMeta(cell: Cell, meta: PegasusMeta): void {
  try {
    (cell.model as any).setMetadata('pegasus', meta);
  } catch {
    // ignore
  }
}

async function streamChat(
  messages: ChatMessage[],
  skillId: string,
  agentId: string,
  onText: (text: string) => void,
  onToolStart: (name: string) => void,
  onToolResult: (name: string, result: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  try {
    const resp = await fetch(`${apiBase()}/llm/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...xsrfHeaders() },
      body: JSON.stringify({
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        skill_id: skillId,
        agent_id: agentId,
      }),
    });

    if (!resp.ok || !resp.body) {
      onError(`HTTP ${resp.status}: ${resp.statusText}`);
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'text')        onText(event.text);
          if (event.type === 'tool_start')  onToolStart(event.name);
          if (event.type === 'tool_result') onToolResult(event.name, event.result);
          if (event.type === 'done')        onDone();
          if (event.type === 'error')       onError(event.error);
        } catch {
          // ignore malformed lines
        }
      }
    }
  } catch (e: any) {
    onError(e.message ?? String(e));
  }
}

// ─── Action skill detection ───────────────────────────────────────────────────

// Skills that require file creation / command execution — redirect to OpenCode
const ACTION_SKILLS = new Set(['scaffold', 'debug', 'wrapper', 'dockerfile', 'convert']);

const ACTION_KEYWORDS = [
  'generate', 'create', 'write', 'build', 'make', 'scaffold',
  'convert', 'migrate', 'transform', 'fix', 'run', 'execute',
  'dockerfile', 'wrapper', 'pipeline', 'workflow',
];

function isActionRequest(skill: string, text: string): boolean {
  if (ACTION_SKILLS.has(skill)) return true;
  const lower = text.toLowerCase();
  return ACTION_KEYWORDS.some(k => lower.includes(k));
}

// ─── OpenCode launcher ────────────────────────────────────────────────────────

const SKILL_INSTRUCTIONS: Record<string, string> = {
  scaffold:   'Generate complete Pegasus WMS workflow scripts (workflow_generator.py, wrapper scripts, Dockerfile). Write all files to ~/work/<name>/.',
  debug:      'Diagnose Pegasus workflow failures: run pegasus-analyzer, read job logs, identify root cause, and apply fixes.',
  review:     'Review Pegasus workflow code for correctness, performance, and best practices. Suggest improvements.',
  wrapper:    'Create argparse-based wrapper scripts for Pegasus jobs using subprocess.run() for external tools.',
  dockerfile: 'Write optimised Dockerfiles for Pegasus job containers (python:3.11-slim base unless specified).',
  convert:    'Convert Snakemake/Nextflow/CWL/WDL pipelines to equivalent Pegasus WMS Python workflows.',
  help:       'Answer questions about Pegasus WMS concepts, API, configuration, and best practices.',
  kiso:       'Integrate Kiso/PEARC data services and APIs into Pegasus workflows.',
  provd:      'Set up provenance tracking, data lineage, and reproducibility metadata for Pegasus workflows.',
};

async function openCodeInTerminal(agent = 'pegasus-workflow-architect', skill = 'scaffold', message = ''): Promise<void> {
  const base = pageBase();
  const headers = { ...xsrfHeaders(), 'Content-Type': 'application/json' };

  const skillDesc = SKILL_INSTRUCTIONS[skill] ?? skill;
  const config = {
    $schema: 'https://opencode.ai/config.json',
    instructions: `You are the Pegasus WMS ${agent}. Active skill: ${skill}. ${skillDesc} Always write files to /home/pegasus/work/. Follow Pegasus WMS best practices.`,
  };
  try {
    await fetch(`${window.location.origin}${base}api/contents/.opencode/config.json`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ type: 'file', format: 'text', content: JSON.stringify(config, null, 2) }),
    });
  } catch { /* non-fatal */ }

  const termResp = await fetch(`${window.location.origin}${base}api/terminals`, { method: 'POST', headers });
  if (!termResp.ok) { console.error('Pegasus: failed to create terminal', termResp.status); return; }
  const { name } = await termResp.json();
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProto}//${window.location.host}${base}terminals/websocket/${name}`);
  await new Promise<void>(resolve => {
    ws.onopen = () => {
      // Launch opencode; if a message was provided, pipe it in after a short delay
      const cmd = message
        ? `opencode run ${JSON.stringify(message)}\r`
        : 'opencode\r';
      ws.send(JSON.stringify(['stdin', cmd]));
      setTimeout(() => { ws.close(); resolve(); }, 300);
    };
    ws.onerror = () => resolve();
  });
  if (_app) await _app.commands.execute('terminal:open', { name });
}

// ─── Config panel ─────────────────────────────────────────────────────────────

const FALLBACK_PROVIDERS = ['anthropic', 'openai', 'fabric', 'nrp', 'ollama', 'custom'];

async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    // derive host from base_url (strip /v1 suffix)
    const host = baseUrl.replace(/\/v1\/?$/, '') || 'http://localhost:11434';
    const resp = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.models as any[]).map((m: any) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}

function ConfigPanel({ onClose }: { onClose: () => void }) {
  const [providers, setProviders]       = useState<string[]>(FALLBACK_PROVIDERS);
  const [provider, setProvider]         = useState('ollama');
  const [model, setModel]               = useState('');
  const [apiKey, setApiKey]             = useState('');
  const [baseUrl, setBaseUrl]           = useState('http://localhost:11434/v1');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'loading' | 'ok' | 'unreachable'>('idle');
  const [status, setStatus]             = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // load saved config once
  useEffect(() => {
    fetchLLMConfig().then(cfg => {
      if (cfg.providers?.length) setProviders(cfg.providers);
      if (cfg.provider)  setProvider(cfg.provider);
      if (cfg.model)     setModel(cfg.model);
      if (cfg.base_url)  setBaseUrl(cfg.base_url || 'http://localhost:11434/v1');
    }).catch(() => { /* keep fallback defaults */ });
  }, []);

  // fetch Ollama models whenever provider === 'ollama' or baseUrl changes
  useEffect(() => {
    if (provider !== 'ollama') { setOllamaModels([]); setOllamaStatus('idle'); return; }
    setOllamaStatus('loading');
    fetchOllamaModels(baseUrl).then(models => {
      setOllamaModels(models);
      setOllamaStatus(models.length > 0 ? 'ok' : 'unreachable');
      if (models.length > 0 && !models.includes(model)) setModel(models[0]);
    });
  }, [provider, baseUrl]);

  const handleSave = async () => {
    setStatus('saving');
    try {
      await saveLLMConfig(provider, model, apiKey, baseUrl);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
    }
  };

  const needsBaseUrl = provider === 'custom' || provider === 'ollama';
  const needsApiKey  = provider !== 'ollama';

  return (
    <div className="pgc-config">
      <div className="pgc-config-header">
        <span className="pgc-config-title">⚙ LLM Configuration</span>
        <button className="jp-pegasus-icon-btn" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="pgc-config-row">
        <label className="pgc-config-label">Provider</label>
        <select className="jp-pegasus-select pgc-config-input" value={provider}
          onChange={e => setProvider(e.target.value)}>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {needsBaseUrl && (
        <div className="pgc-config-row">
          <label className="pgc-config-label">Base URL</label>
          <input className="pgc-config-input" type="text" value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
        </div>
      )}

      <div className="pgc-config-row">
        <label className="pgc-config-label">Model</label>
        {provider === 'ollama' ? (
          ollamaStatus === 'loading' ? (
            <span className="pgc-config-hint">scanning Ollama…</span>
          ) : ollamaStatus === 'unreachable' ? (
            <>
              <input className="pgc-config-input" type="text" value={model}
                onChange={e => setModel(e.target.value)} placeholder="Ollama not reachable — type model name" />
              <button className="jp-pegasus-icon-btn" title="Retry"
                onClick={() => { setOllamaStatus('loading'); fetchOllamaModels(baseUrl).then(ms => { setOllamaModels(ms); setOllamaStatus(ms.length > 0 ? 'ok' : 'unreachable'); if (ms.length > 0 && !ms.includes(model)) setModel(ms[0]); }); }}>↺</button>
            </>
          ) : (
            <select className="jp-pegasus-select pgc-config-input" value={model}
              onChange={e => setModel(e.target.value)}>
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )
        ) : (
          <input className="pgc-config-input" type="text" value={model}
            onChange={e => setModel(e.target.value)} placeholder="leave blank for default" />
        )}
      </div>

      {needsApiKey && (
        <div className="pgc-config-row">
          <label className="pgc-config-label">API Key</label>
          <input className="pgc-config-input" type="password" value={apiKey}
            onChange={e => setApiKey(e.target.value)} placeholder="sk-…  (leave blank to keep existing)" />
        </div>
      )}

      <div className="pgc-config-footer">
        <button className="jp-pegasus-action-btn jp-pegasus-action-btn--primary"
          onClick={handleSave} disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : 'Save'}
        </button>
        {ollamaStatus === 'ok' && <span className="pgc-config-hint pgc-config-hint--ok">● Ollama connected · {ollamaModels.length} model{ollamaModels.length !== 1 ? 's' : ''}</span>}
        {ollamaStatus === 'unreachable' && <span className="pgc-config-hint pgc-config-hint--warn">● Ollama not reachable</span>}
        {status === 'error' && <span className="pgc-config-err">Save failed</span>}
      </div>
    </div>
  );
}

// ─── Message components ───────────────────────────────────────────────────────

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="pgc-msg pgc-msg--user">
      <div className="pgc-avatar pgc-avatar--user">me</div>
      <div className="pgc-msg-body">
        <div className="pgc-msg-meta">
          you · {msg.timestamp}
          {msg.skill && <span className="pgc-skill-badge">/{msg.skill}</span>}
        </div>
        <div className="pgc-user-bubble">{msg.content}</div>
      </div>
    </div>
  );
}

function AssistantMessage({ msg }: { msg: ChatMessage }) {
  const parts = msg.content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="pgc-msg pgc-msg--ai">
      <div className="pgc-avatar pgc-avatar--ai">⬡</div>
      <div className="pgc-msg-body">
        <div className="pgc-msg-meta">pegasus · {msg.timestamp}</div>
        <div className="pgc-msg-text">
          {(msg.toolCalls ?? []).map((tc, i) => (
            <div key={i} className={`pgc-tool-result pgc-tool-result--${tc.result ? 'success' : 'running'}`}>
              <span className="pgc-tool-icon">{tc.result ? '✓' : '⟳'}</span>
              <span className="pgc-tool-name">{tc.name}</span>
              {tc.result && <span className="pgc-tool-text"> {tc.result.slice(0, 120)}</span>}
            </div>
          ))}
          {parts.map((part, i) => {
            if (part.startsWith('```')) {
              const lines = part.slice(3, -3).split('\n');
              const lang = lines[0] ?? '';
              const code = lines.slice(1).join('\n');
              return (
                <div key={i} className="pgc-code-block">
                  <div className="pgc-code-header">
                    <span className="pgc-code-lang">{lang || 'code'}</span>
                    <button className="pgc-code-copy" onClick={() => navigator.clipboard.writeText(code)}>
                      copy
                    </button>
                  </div>
                  <pre className="pgc-code-pre">{code}</pre>
                </div>
              );
            }
            return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const DEFAULT_SKILLS = ['scaffold', 'debug', 'review', 'wrapper', 'dockerfile', 'convert', 'help', 'kiso', 'provd'];
const DEFAULT_AGENTS = ['pegasus-workflow-architect', 'pegasus-data-engineer', 'pegasus-pipeline-debugger'];

function PegasusCellComponent({ cell }: { cell: Cell }) {
  const meta = getMeta(cell);
  const [messages, setMessages]     = useState<ChatMessage[]>(meta.messages);
  const [skill, setSkill]           = useState(meta.skill);
  const [agent, setAgent]           = useState(meta.agent);
  const [input, setInput]           = useState('');
  const [streaming, setStreaming]   = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamTools, setStreamTools] = useState<ToolCall[]>([]);
  const [error, setError]                     = useState<string | null>(null);
  const [showConfig, setShowConfig]           = useState(false);
  const [opencodePrompt, setOpencodePrompt]   = useState<string | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // auto-focus textarea when a brand-new cell is inserted
  useEffect(() => {
    if (meta.messages.length === 0) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, []);

  useEffect(() => {
    saveMeta(cell, { agent, skill, messages });
  }, [messages, skill, agent]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming, streamText]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    if (isActionRequest(skill, text)) {
      setInput('');
      setOpencodePrompt(text);
      return;
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: now, skill };
    const nextMessages = [...messages, userMsg];

    setMessages(nextMessages);
    setInput('');
    setStreaming(true);
    setStreamText('');
    setStreamTools([]);
    setError(null);

    let accText = '';
    const accTools: ToolCall[] = [];

    await streamChat(
      nextMessages, skill, agent,
      chunk => { accText += chunk; setStreamText(accText); },
      name  => { accTools.push({ name }); setStreamTools([...accTools]); },
      (name, result) => {
        const tc = accTools.find(t => t.name === name && !t.result);
        if (tc) tc.result = result;
        setStreamTools([...accTools]);
      },
      () => {
        const aiMsg: ChatMessage = {
          role: 'assistant',
          content: accText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          toolCalls: accTools.length > 0 ? [...accTools] : undefined,
        };
        setMessages(prev => [...prev, aiMsg]);
        setStreaming(false);
        setStreamText('');
        setStreamTools([]);
      },
      err => { setError(err); setStreaming(false); }
    );
  }, [input, streaming, messages, skill, agent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    // slash command: /skillname auto-switches skill
    const match = val.match(/^\/([a-z]+)\b/i);
    if (match) {
      const cmd = match[1].toLowerCase();
      if (DEFAULT_SKILLS.includes(cmd)) setSkill(cmd);
    }
    setInput(val);
  };

  return (
    <div className="jp-pegasus-cell">

      {/* Header */}
      <div className="jp-pegasus-header">
        <div className="jp-pegasus-header__left">
          <span className="jp-pegasus-badge">⬡ Pegasus</span>
          <select className="jp-pegasus-agent-select" value={agent}
            onChange={e => setAgent(e.target.value)} aria-label="Agent">
            {DEFAULT_AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="jp-pegasus-header__right">
          {messages.length > 0 && (
            <button className="jp-pegasus-icon-btn" onClick={() => setMessages([])} title="Clear chat">⌫</button>
          )}
          <button
            className={`jp-pegasus-icon-btn${showConfig ? ' jp-pegasus-icon-btn--active' : ''}`}
            onClick={() => setShowConfig(v => !v)} title="Configure LLM">⚙</button>
        </div>
      </div>

      {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}

      {opencodePrompt && (
        <div className="pgc-opencode-redirect">
          <div className="pgc-opencode-redirect__icon">⟩_</div>
          <div className="pgc-opencode-redirect__body">
            <div className="pgc-opencode-redirect__title">This task needs to create files or run commands</div>
            <div className="pgc-opencode-redirect__msg">"{opencodePrompt}"</div>
            <div className="pgc-opencode-redirect__actions">
              <button className="pgc-opencode-redirect__btn pgc-opencode-redirect__btn--primary"
                onClick={() => {
                  openCodeInTerminal(agent, skill, opencodePrompt).catch(console.error);
                  setOpencodePrompt(null);
                }}>
                Open in OpenCode
              </button>
              <button className="pgc-opencode-redirect__btn"
                onClick={() => {
                  setOpencodePrompt(null);
                  setInput(opencodePrompt);
                }}>
                Chat anyway
              </button>
              <button className="pgc-opencode-redirect__btn pgc-opencode-redirect__btn--dismiss"
                onClick={() => setOpencodePrompt(null)}>
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skill pills */}
      <div className="jp-pegasus-skills">
        {DEFAULT_SKILLS.map(s => (
          <button key={s}
            className={`jp-pegasus-skill-pill${skill === s ? ' jp-pegasus-skill-pill--active' : ''}`}
            onClick={() => setSkill(s)}>
            {s}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="jp-pegasus-messages">
        {messages.length === 0 && !streaming && (
          <div className="jp-pegasus-empty">
            <div className="jp-pegasus-empty__icon">⬡</div>
            <div className="jp-pegasus-empty__title">Pegasus AI Assistant</div>
            <div className="jp-pegasus-empty__text">
              Select a skill above and describe what you need,<br />
              or type a slash command like <code>/scaffold</code> in the input.
            </div>
            <div className="jp-pegasus-empty__examples">
              <button className="jp-pegasus-example-btn" onClick={() => { setSkill('scaffold'); setInput('Generate an RNAseq workflow'); }}>
                Generate an RNAseq workflow
              </button>
              <button className="jp-pegasus-example-btn" onClick={() => { setSkill('debug'); setInput('My jobs are failing with a staging error'); }}>
                My jobs are failing with a staging error
              </button>
              <button className="jp-pegasus-example-btn" onClick={() => { setSkill('convert'); setInput('Convert my Snakemake pipeline to Pegasus'); }}>
                Convert my Snakemake pipeline
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === 'user'
            ? <UserMessage key={i} msg={msg} />
            : <AssistantMessage key={i} msg={msg} />
        )}

        {streaming && (
          <div className="pgc-msg pgc-msg--ai">
            <div className="pgc-avatar pgc-avatar--ai">⬡</div>
            <div className="pgc-msg-body">
              <div className="pgc-msg-meta">pegasus · {skill}</div>
              <div className="pgc-msg-text">
                {streamTools.map((tc, i) => (
                  <div key={i} className={`pgc-tool-result pgc-tool-result--${tc.result ? 'success' : 'running'}`}>
                    <span className="pgc-tool-icon">{tc.result ? '✓' : '⟳'}</span>
                    <span className="pgc-tool-name">{tc.name}</span>
                    {tc.result && <span className="pgc-tool-text"> {tc.result.slice(0, 120)}</span>}
                  </div>
                ))}
                {streamText
                  ? <span style={{ whiteSpace: 'pre-wrap' }}>{streamText}</span>
                  : <div className="pgc-streaming"><span className="pgc-dot"/><span className="pgc-dot"/><span className="pgc-dot"/></div>
                }
              </div>
            </div>
          </div>
        )}

        {error && <div className="pgc-error">⚠ {error}</div>}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      <div className="jp-pegasus-actions">
        <button className="jp-pegasus-action-btn jp-pegasus-action-btn--primary"
          onClick={() => { setSkill('scaffold'); setInput('Run pegasus-plan on the local site'); }}>▶ plan</button>
        <button className="jp-pegasus-action-btn"
          onClick={() => setInput('Submit the workflow')}>↑ submit</button>
        <button className="jp-pegasus-action-btn"
          onClick={() => setInput('Show condor_q status')}>⟳ monitor</button>
        <button className="jp-pegasus-action-btn"
          onClick={() => { setSkill('debug'); setInput('Run pegasus-analyzer and explain failures'); }}>⚠ debug</button>
        <button className="jp-pegasus-action-btn"
          onClick={() => { setSkill('review'); setInput('Review my workflow for best practices'); }}>✓ review</button>
        <button className="jp-pegasus-action-btn jp-pegasus-action-btn--opencode"
          onClick={() => openCodeInTerminal(agent, skill).catch(e => console.error('OpenCode:', e))}
          title={`Open OpenCode as ${agent} / ${skill}`}>⟩_ opencode</button>
      </div>

      {/* Input */}
      <div className="jp-pegasus-input">
        <div className="jp-pegasus-input__inner">
          <div className="jp-pegasus-input__skill-tag">/{skill}</div>
          <textarea
            ref={textareaRef}
            className="jp-pegasus-textarea"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Ask anything, or type /${skill} <message>…  (Enter to send, Shift+Enter for newline)`}
            rows={3}
            disabled={streaming}
          />
        </div>
        <button
          className={`jp-pegasus-send-btn${streaming ? ' jp-pegasus-send-btn--disabled' : ''}`}
          onClick={sendMessage}
          disabled={streaming || !input.trim()}
          aria-label="Send"
        >
          {streaming
            ? <div className="pgc-streaming"><span className="pgc-dot"/><span className="pgc-dot"/><span className="pgc-dot"/></div>
            : '↑'}
        </button>
      </div>

    </div>
  );
}

// ─── Standalone panel (no cell dependency) ────────────────────────────────────

const LS_KEY = 'pegasus-panel-state';

function loadPanelState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as { agent: string; skill: string; messages: ChatMessage[] };
  } catch { /* ignore */ }
  return { agent: 'pegasus-workflow-architect', skill: 'scaffold', messages: [] as ChatMessage[] };
}

export function PegasusPanelComponent(): JSX.Element {
  const init = loadPanelState();
  const [messages, setMessages]       = useState<ChatMessage[]>(init.messages);
  const [skill, setSkill]             = useState(init.skill);
  const [agent, setAgent]             = useState(init.agent);
  const [input, setInput]             = useState('');
  const [streaming, setStreaming]     = useState(false);
  const [streamText, setStreamText]   = useState('');
  const [streamTools, setStreamTools] = useState<ToolCall[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ agent, skill, messages })); } catch { /* ignore */ }
  }, [messages, skill, agent]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming, streamText]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: now, skill };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages); setInput(''); setStreaming(true); setStreamText(''); setStreamTools([]); setError(null);
    let accText = '';
    const accTools: ToolCall[] = [];
    await streamChat(
      nextMessages, skill, agent,
      chunk => { accText += chunk; setStreamText(accText); },
      name  => { accTools.push({ name }); setStreamTools([...accTools]); },
      (name, result) => { const tc = accTools.find(t => t.name === name && !t.result); if (tc) tc.result = result; setStreamTools([...accTools]); },
      () => {
        setMessages(prev => [...prev, { role: 'assistant', content: accText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          toolCalls: accTools.length > 0 ? [...accTools] : undefined }]);
        setStreaming(false); setStreamText(''); setStreamTools([]);
      },
      err => { setError(err); setStreaming(false); }
    );
  }, [input, streaming, messages, skill, agent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const match = val.match(/^\/([a-z]+)\b/i);
    if (match) { const cmd = match[1].toLowerCase(); if (DEFAULT_SKILLS.includes(cmd)) setSkill(cmd); }
    setInput(val);
  };

  return (
    <div className="jp-pegasus-cell jp-pegasus-panel">
      <div className="jp-pegasus-header">
        <div className="jp-pegasus-header__left">
          <span className="jp-pegasus-badge">⬡ Pegasus</span>
          <select className="jp-pegasus-agent-select" value={agent} onChange={e => setAgent(e.target.value)} aria-label="Agent">
            {DEFAULT_AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="jp-pegasus-header__right">
          {messages.length > 0 && (
            <button className="jp-pegasus-icon-btn" onClick={() => setMessages([])} title="Clear chat">⌫</button>
          )}
          <button className={`jp-pegasus-icon-btn${showConfig ? ' jp-pegasus-icon-btn--active' : ''}`}
            onClick={() => setShowConfig(v => !v)} title="Configure LLM">⚙</button>
        </div>
      </div>

      {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}

      <div className="jp-pegasus-messages">
        {messages.length === 0 && !streaming && (
          <div className="jp-pegasus-empty">
            <div className="jp-pegasus-empty__icon">⬡</div>
            <div className="jp-pegasus-empty__title">Pegasus AI Assistant</div>
            <div className="jp-pegasus-empty__text">
              Ask anything about Pegasus WMS — workflows, debugging, best practices, and more.
            </div>
            <div className="jp-pegasus-empty__examples">
              <button className="jp-pegasus-example-btn" onClick={() => { setSkill('scaffold'); setInput('Generate an RNAseq workflow'); }}>Generate an RNAseq workflow</button>
              <button className="jp-pegasus-example-btn" onClick={() => { setSkill('debug'); setInput('My jobs are failing with a staging error'); }}>My jobs are failing with a staging error</button>
              <button className="jp-pegasus-example-btn" onClick={() => { setSkill('convert'); setInput('Convert my Snakemake pipeline to Pegasus'); }}>Convert my Snakemake pipeline</button>
            </div>
          </div>
        )}
        {messages.map((msg, i) => msg.role === 'user' ? <UserMessage key={i} msg={msg} /> : <AssistantMessage key={i} msg={msg} />)}
        {streaming && (
          <div className="pgc-msg pgc-msg--ai">
            <div className="pgc-avatar pgc-avatar--ai">⬡</div>
            <div className="pgc-msg-body">
              <div className="pgc-msg-meta">pegasus · {skill}</div>
              <div className="pgc-msg-text">
                {streamTools.map((tc, i) => (
                  <div key={i} className={`pgc-tool-result pgc-tool-result--${tc.result ? 'success' : 'running'}`}>
                    <span className="pgc-tool-icon">{tc.result ? '✓' : '⟳'}</span>
                    <span className="pgc-tool-name">{tc.name}</span>
                    {tc.result && <span className="pgc-tool-text"> {tc.result.slice(0, 120)}</span>}
                  </div>
                ))}
                {streamText ? <span style={{ whiteSpace: 'pre-wrap' }}>{streamText}</span>
                  : <div className="pgc-streaming"><span className="pgc-dot"/><span className="pgc-dot"/><span className="pgc-dot"/></div>}
              </div>
            </div>
          </div>
        )}
        {error && <div className="pgc-error">⚠ {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="jp-pegasus-actions">
        <button className="jp-pegasus-action-btn jp-pegasus-action-btn--primary"
          onClick={() => { setSkill('scaffold'); setInput('Run pegasus-plan on the local site'); }}>▶ plan</button>
        <button className="jp-pegasus-action-btn" onClick={() => setInput('Submit the workflow')}>↑ submit</button>
        <button className="jp-pegasus-action-btn" onClick={() => setInput('Show condor_q status')}>⟳ monitor</button>
        <button className="jp-pegasus-action-btn" onClick={() => { setSkill('debug'); setInput('Run pegasus-analyzer and explain failures'); }}>⚠ debug</button>
        <button className="jp-pegasus-action-btn" onClick={() => { setSkill('review'); setInput('Review my workflow for best practices'); }}>✓ review</button>
        <button className="jp-pegasus-action-btn jp-pegasus-action-btn--opencode"
          onClick={() => openCodeInTerminal(agent, skill).catch(e => console.error('OpenCode:', e))}
          title={`Open OpenCode as ${agent} / ${skill}`}>⟩_ opencode</button>
      </div>

      <div className="jp-pegasus-input">
        <div className="jp-pegasus-input__inner">
          <textarea ref={textareaRef} className="jp-pegasus-textarea" value={input}
            onChange={handleInputChange} onKeyDown={handleKeyDown}
            placeholder="Ask anything about Pegasus WMS… (Enter to send, Shift+Enter for newline)"
            rows={3} disabled={streaming} />
        </div>
        <button className={`jp-pegasus-send-btn${streaming ? ' jp-pegasus-send-btn--disabled' : ''}`}
          onClick={sendMessage} disabled={streaming || !input.trim()} aria-label="Send">
          {streaming ? <div className="pgc-streaming"><span className="pgc-dot"/><span className="pgc-dot"/><span className="pgc-dot"/></div> : '↑'}
        </button>
      </div>
    </div>
  );
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const _mountedCells = new WeakSet<Cell>();

export function renderPegasusCell(cell: Cell): void {
  if (_mountedCells.has(cell)) return;
  _mountedCells.add(cell);

  const inputArea = cell.node.querySelector('.jp-InputArea-editor') as HTMLElement | null;
  if (inputArea) inputArea.style.display = 'none';

  const inputWrapper = cell.node.querySelector('.jp-InputArea') as HTMLElement | null;
  if (!inputWrapper) { _mountedCells.delete(cell); return; }

  const container = document.createElement('div');
  inputWrapper.appendChild(container);
  ReactDOM.createRoot(container).render(<PegasusCellComponent cell={cell} />);
}

// ─── Pegasus + OpenCode embedded panel ────────────────────────────────────────

const THEME_LIGHT = {
  background: '#ffffff', foreground: '#1e1e1e', cursor: '#555555',
  selectionBackground: '#add6ff', black: '#000000', red: '#cd3131',
  green: '#008000', yellow: '#795e26', blue: '#0070c1', magenta: '#af00db',
  cyan: '#267f99', white: '#555555', brightBlack: '#666666', brightRed: '#f44747',
  brightGreen: '#007700', brightYellow: '#a0522d', brightBlue: '#0070c1',
  brightMagenta: '#af00db', brightCyan: '#267f99', brightWhite: '#1e1e1e',
};
const THEME_DARK = {
  background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#aeafad',
  selectionBackground: '#264f78', black: '#000000', red: '#f44747',
  green: '#4ec9b0', yellow: '#dcdcaa', blue: '#569cd6', magenta: '#c586c0',
  cyan: '#9cdcfe', white: '#d4d4d4', brightBlack: '#808080', brightRed: '#f44747',
  brightGreen: '#4ec9b0', brightYellow: '#dcdcaa', brightBlue: '#569cd6',
  brightMagenta: '#c586c0', brightCyan: '#9cdcfe', brightWhite: '#ffffff',
};

export function PegasusOpenCodePanelComponent(): JSX.Element {
  const [agent, setAgent]   = useState('pegasus-workflow-architect');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [pendingSel, setPendingSel] = useState<string>('');
  const [sent, setSent]             = useState(false);
  const [isDark, setIsDark]         = useState(() => localStorage.getItem('pgc-oc-dark') === '1');
  const [watchedFiles, setWatchedFiles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pgc-watch-files') ?? '[]'); } catch { return []; }
  });
  const [fileAlert, setFileAlert]   = useState<string | null>(null);
  const [showWatch, setShowWatch]   = useState(false);
  const [watchInput, setWatchInput] = useState('');
  const isDarkRef   = useRef(isDark);
  const watchRef    = useRef(watchedFiles);
  const fileSnapRef = useRef<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const wsRef        = useRef<WebSocket | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);

  // Send pending selection to OpenCode now
  const syncContext = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const ctx = getJupyterContext();
    const sel = ctx.selection || pendingSel;
    if (!sel && !ctx.cellSource && !ctx.filePath) return;

    const parts: string[] = [];
    if (ctx.filePath)  parts.push(`File: ${ctx.filePath}`);
    if (sel)           parts.push(`Selected:\n${sel}`);
    else if (ctx.cellSource) parts.push(`Active cell:\n${ctx.cellSource}`);

    ws.send(JSON.stringify(['stdin', `[JupyterLab context]\n${parts.join('\n\n')}` + '\r']));
    setPendingSel('');
    setSent(true);
    setTimeout(() => setSent(false), 1500);
  }, [pendingSel]);

  // Launch opencode with a specific agent using the --agent flag (OpenCode's native mechanism)
  const launch = useCallback(async (ag: string) => {
    wsRef.current?.close();
    termRef.current?.dispose();
    setStatus('connecting');

    const base    = pageBase();
    const headers = { ...xsrfHeaders(), 'Content-Type': 'application/json' };

    const termResp = await fetch(`${window.location.origin}${base}api/terminals`, { method: 'POST', headers });
    if (!termResp.ok) { setStatus('error'); return; }
    const { name } = await termResp.json();
    setSessionName(name);
    if (!containerRef.current) { setStatus('error'); return; }

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'var(--jp-code-font-family, "Source Code Pro", monospace)',
      cursorBlink: true,
      scrollback: 5000,
      theme: isDarkRef.current ? THEME_DARK : THEME_LIGHT,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    containerRef.current.innerHTML = '';
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current  = fit;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws    = new WebSocket(`${proto}//${window.location.host}${base}terminals/websocket/${name}`);
    wsRef.current = ws;

    const sendResize = () => {
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['set_size', term.rows, term.cols,
            containerRef.current?.offsetHeight ?? 0,
            containerRef.current?.offsetWidth  ?? 0]));
        }
      } catch { /* ignore */ }
    };

    const ro = new ResizeObserver(sendResize);
    ro.observe(containerRef.current);

    ws.onopen = () => {
      setStatus('connected');
      sendResize();
      // Write banner directly to xterm (client-side only, not sent to shell)
      term.write('\r\n\x1b[1;34m  ⬡ Pegasus Assistant\x1b[0m  \x1b[90mfor Pegasus WMS\x1b[0m\r\n');
      term.write('\x1b[90m  ─────────────────────────────────────\x1b[0m\r\n\r\n');
      const ctx = getJupyterContext();
      const dir = ctx.notebookDir && ctx.notebookDir !== '.' ? ctx.notebookDir : '';
      const oc  = `opencode --agent ${ag}`;
      const cmd = dir ? `cd ${JSON.stringify(dir)} && clear && ${oc}\r` : `clear && ${oc}\r`;
      ws.send(JSON.stringify(['stdin', cmd]));
    };
    ws.onmessage = e => {
      try {
        const [type, data] = JSON.parse(e.data) as [string, string];
        if (type === 'stdout') term.write(data);
      } catch { /* ignore */ }
    };
    ws.onerror = () => setStatus('error');
    ws.onclose = () => { if (status !== 'idle') setStatus('idle'); };

    term.onData(d => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(['stdin', d])));

    term.onResize(({ rows, cols }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['set_size', rows, cols,
          containerRef.current?.offsetHeight ?? 0,
          containerRef.current?.offsetWidth  ?? 0]));
      }
    });

    const doFit = () => {
      if (containerRef.current && containerRef.current.offsetWidth > 0) { sendResize(); }
      else { requestAnimationFrame(doFit); }
    };
    requestAnimationFrame(doFit);
  }, []);

  // Kill the Jupyter terminal session on the server
  const killSession = useCallback(async (name: string) => {
    const base = pageBase();
    try {
      await fetch(`${window.location.origin}${base}api/terminals/${name}`, {
        method: 'DELETE',
        headers: xsrfHeaders(),
      });
    } catch { /* ignore */ }
  }, []);

  // Launch on mount; kill session on unmount
  useEffect(() => {
    launch(agent);
    return () => {
      wsRef.current?.close();
      termRef.current?.dispose();
      // Kill the server-side terminal when panel is closed
      setSessionName(prev => { if (prev) killSession(prev); return null; });
    };
  }, []);

  // Debounced selectionchange — auto-inject selection into OpenCode when user selects text
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSelection = () => {
      const sel = window.getSelection()?.toString().trim();
      if (!sel || sel.length < 10) return;
      if (timer) clearTimeout(timer);
      // Just store the selection — don't send yet, wait for user action
      timer = setTimeout(() => setPendingSel(sel), 600);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Agent change
  const handleAgent = (a: string) => { setAgent(a); launch(a); };

  // Dark/light toggle — updates xterm theme live
  const toggleDark = () => {
    const next = !isDarkRef.current;
    isDarkRef.current = next;
    setIsDark(next);
    localStorage.setItem('pgc-oc-dark', next ? '1' : '0');
    if (termRef.current) termRef.current.options.theme = next ? THEME_DARK : THEME_LIGHT;
    if (containerRef.current) containerRef.current.style.background = next ? '#1e1e1e' : '#ffffff';
  };

  // Send full notebook as context
  const syncNotebook = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const ctx = getJupyterContext();
    if (!ctx.notebookCells) return;
    ws.send(JSON.stringify(['stdin', `[Full notebook: ${ctx.filePath}]\n${ctx.notebookCells}` + '\r']));
    setSent(true); setTimeout(() => setSent(false), 1500);
  }, []);

  // Send last error as context
  const syncError = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const ctx = getJupyterContext();
    if (!ctx.lastError) return;
    ws.send(JSON.stringify(['stdin', `[Cell error]\n${ctx.lastError}` + '\r']));
    setSent(true); setTimeout(() => setSent(false), 1500);
  }, []);

  // Keep refs in sync with state for use inside callbacks
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);
  useEffect(() => {
    watchRef.current = watchedFiles;
    localStorage.setItem('pgc-watch-files', JSON.stringify(watchedFiles));
  }, [watchedFiles]);

  // File watcher — poll every 3s
  useEffect(() => {
    const base = pageBase();
    const poll = setInterval(async () => {
      for (const path of watchRef.current) {
        try {
          const r = await fetch(`${window.location.origin}${base}api/contents/${path}`, {
            headers: xsrfHeaders(),
          });
          if (!r.ok) continue;
          const data = await r.json();
          const content = data.content ?? '';
          if (fileSnapRef.current[path] !== undefined && fileSnapRef.current[path] !== content) {
            setFileAlert(`📄 ${path} changed`);
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(['stdin', `[File changed: ${path}]\n${content.slice(0, 800)}` + '\r']));
            }
          }
          fileSnapRef.current[path] = content;
        } catch { /* ignore */ }
      }
    }, 3000);
    return () => clearInterval(poll);
  }, []);

  // Auto-send lastError to OpenCode when a cell fails
  useEffect(() => {
    const ctx = getJupyterContext();
    if (!ctx.lastError) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(['stdin', `[Cell execution error]\n${ctx.lastError}` + '\r']));
    }
  // poll every 2s for new errors
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addWatchFile = () => {
    const p = watchInput.trim();
    if (p && !watchedFiles.includes(p)) setWatchedFiles(f => [...f, p]);
    setWatchInput(''); setShowWatch(false);
  };

  const statusDot   = status === 'connected' ? '●' : status === 'connecting' ? '○' : status === 'error' ? '✕' : '○';
  const statusColor = status === 'connected' ? '#4ec9b0' : status === 'error' ? '#f44747' : '#d7ba7d';

  return (
    <div className="jp-pegasus-cell jp-pegasus-panel jp-pegasus-oc-panel">
      {/* Header */}
      <div className="jp-pegasus-header">
        <div className="jp-pegasus-header__left">
          <span className="jp-pegasus-badge">OpenCode for Pegasus WMS</span>
          <select className="jp-pegasus-agent-select" value={agent} onChange={e => handleAgent(e.target.value)} aria-label="Agent">
            {DEFAULT_AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="jp-pegasus-header__right">
          <span className="pgc-oc-status" style={{ color: statusColor, fontSize: 11 }}>
            {statusDot} {status}
          </span>
          <button className="jp-pegasus-icon-btn" onClick={syncContext}
            title="Send selection to OpenCode"
            style={{ color: sent ? '#4ec9b0' : pendingSel ? '#f0c040' : undefined }}>
            {sent ? '✓' : '📎'}
          </button>
          <button className="jp-pegasus-icon-btn" onClick={syncNotebook} title="Send full notebook as context">📓</button>
          <button className="jp-pegasus-icon-btn" onClick={syncError} title="Send last cell error to OpenCode">⚠</button>
          <button className="jp-pegasus-icon-btn" onClick={() => setShowWatch(v => !v)} title="Watch files">👁</button>
          <button className="jp-pegasus-icon-btn" onClick={toggleDark} title="Toggle dark/light mode">{isDark ? '☀' : '🌙'}</button>
          <button className="jp-pegasus-icon-btn" onClick={() => launch(agent)} title="Restart OpenCode">↺</button>
        </div>
      </div>

      {/* Selection indicator */}
      {pendingSel && !sent && (
        <div className="pgc-oc-sel-banner">
          <span>📎 Selection captured — click 📎 to send</span>
          <button onClick={() => setPendingSel('')} title="Dismiss">✕</button>
        </div>
      )}

      {/* File alert */}
      {fileAlert && (
        <div className="pgc-oc-sel-banner" style={{ borderColor: '#4ec9b0' }}>
          <span>{fileAlert}</span>
          <button onClick={() => setFileAlert(null)}>✕</button>
        </div>
      )}

      {/* File watcher input */}
      {showWatch && (
        <div className="pgc-oc-watch">
          <div className="pgc-oc-watch__row">
            <input className="pgc-oc-watch__input" value={watchInput}
              onChange={e => setWatchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addWatchFile()}
              placeholder="File path to watch (e.g. workflow.py)" />
            <button onClick={addWatchFile}>Add</button>
          </div>
          {watchedFiles.length > 0 && (
            <div className="pgc-oc-watch__list">
              {watchedFiles.map(f => (
                <span key={f} className="pgc-oc-watch__tag">
                  {f} <button onClick={() => setWatchedFiles(fs => fs.filter(x => x !== f))}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Embedded OpenCode terminal */}
      <div ref={containerRef} className="pgc-oc-terminal"
        style={{ background: isDark ? '#1e1e1e' : '#ffffff' }} />

      {sessionName && (
        <div className="pgc-oc-footer">
          <span>session: <code>{sessionName}</code></span>
          <div className="pgc-oc-footer__actions">
            <button title="New session" onClick={() => { killSession(sessionName); launch(agent); }}>⊕ new</button>
            <button title="Kill session" onClick={() => { killSession(sessionName); setSessionName(null); wsRef.current?.close(); termRef.current?.dispose(); setStatus('idle'); }}>⊗ kill</button>
          </div>
        </div>
      )}
    </div>
  );
}
