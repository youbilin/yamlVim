import { useState } from 'react';
import { Check, Layers, ListPlus, PencilLine, Sparkles } from 'lucide-react';

import { errorMessage } from '../api';
import { Select } from './Select';
import { SideSheet } from './SideSheet';
import { toast } from '../store/toast';

const RULE_TYPES = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'GEOIP',
  'GEOSITE',
  'IP-CIDR',
  'IP-CIDR6',
  'SRC-IP-CIDR',
  'PROCESS-NAME',
  'RULE-SET',
  'MATCH',
];

const IP_TYPES = new Set(['IP-CIDR', 'IP-CIDR6', 'SRC-IP-CIDR']);

interface Preset {
  id: string;
  name: string;
  type: string;
  value: string;
  target?: string;
  hint?: string;
}

const PRESETS: Preset[] = [
  { id: 'openai', name: 'OpenAI', type: 'DOMAIN-SUFFIX', value: 'openai.com' },
  { id: 'chatgpt', name: 'ChatGPT', type: 'DOMAIN-SUFFIX', value: 'chatgpt.com' },
  { id: 'claude', name: 'Claude', type: 'DOMAIN-SUFFIX', value: 'anthropic.com' },
  { id: 'gemini', name: 'Gemini', type: 'DOMAIN-SUFFIX', value: 'gemini.google.com' },
  { id: 'github', name: 'GitHub', type: 'DOMAIN-SUFFIX', value: 'github.com' },
  { id: 'google', name: 'Google', type: 'DOMAIN-SUFFIX', value: 'google.com' },
  { id: 'youtube', name: 'YouTube', type: 'DOMAIN-SUFFIX', value: 'youtube.com' },
  { id: 'telegram', name: 'Telegram', type: 'DOMAIN-SUFFIX', value: 'telegram.org' },
  { id: 'x', name: 'X / Twitter', type: 'DOMAIN-SUFFIX', value: 'x.com' },
  { id: 'netflix', name: 'Netflix', type: 'DOMAIN-SUFFIX', value: 'netflix.com' },
  { id: 'spotify', name: 'Spotify', type: 'DOMAIN-SUFFIX', value: 'spotify.com' },
  { id: 'apple', name: 'Apple', type: 'DOMAIN-SUFFIX', value: 'apple.com' },
  { id: 'microsoft', name: 'Microsoft', type: 'DOMAIN-SUFFIX', value: 'microsoft.com' },
  {
    id: 'ads',
    name: '广告拦截',
    type: 'GEOSITE',
    value: 'category-ads-all',
    target: 'REJECT',
    hint: '推荐 REJECT',
  },
  {
    id: 'lan',
    name: '局域网直连',
    type: 'GEOSITE',
    value: 'private',
    target: 'DIRECT',
    hint: '推荐 DIRECT',
  },
  {
    id: 'cn',
    name: '中国大陆直连',
    type: 'GEOIP',
    value: 'CN',
    target: 'DIRECT',
    hint: '推荐 DIRECT',
  },
  {
    id: 'final',
    name: '最终兜底',
    type: 'MATCH',
    value: '',
    target: 'DIRECT',
    hint: '通常放最后',
  },
];

interface RuleDraft {
  type: string;
  value: string;
  target: string;
  noResolve: boolean;
}

interface RuleSheetProps {
  initial: string | null;
  targets: string[];
  ruleSets: string[];
  onSave: (rules: string[]) => Promise<void>;
  onClose: () => void;
}

function parseRule(rule: string | null): RuleDraft {
  if (!rule) {
    return { type: 'DOMAIN-SUFFIX', value: '', target: 'DIRECT', noResolve: false };
  }
  const parts = rule.split(',').map((part) => part.trim());
  const type = parts[0] || 'DOMAIN-SUFFIX';
  if (type === 'MATCH') {
    return { type, value: '', target: parts[1] || 'DIRECT', noResolve: false };
  }
  return {
    type,
    value: parts[1] || '',
    target: parts[2] || 'DIRECT',
    noResolve: parts[3] === 'no-resolve',
  };
}

function buildRule(draft: RuleDraft): string {
  if (draft.type === 'MATCH') return `MATCH,${draft.target}`;
  return [
    draft.type,
    draft.value.trim(),
    draft.target,
    ...(draft.noResolve && IP_TYPES.has(draft.type) ? ['no-resolve'] : []),
  ]
    .filter(Boolean)
    .join(',');
}

function presetRule(preset: Preset, target: string): string {
  const resolved = preset.target ?? target;
  if (preset.type === 'MATCH') return `MATCH,${resolved}`;
  return [preset.type, preset.value, resolved].filter(Boolean).join(',');
}

export function RuleSheet({ initial, targets, ruleSets, onSave, onClose }: RuleSheetProps) {
  const targetOptions = Array.from(new Set(['DIRECT', 'REJECT', ...targets]));
  const defaultTarget =
    targetOptions.find((target) => target !== 'DIRECT' && target !== 'REJECT') ?? 'DIRECT';
  const [tab, setTab] = useState<'presets' | 'manual' | 'batch' | 'rulesets'>(
    initial ? 'manual' : 'presets',
  );
  const [draft, setDraft] = useState<RuleDraft>(() => parseRule(initial));
  const [presetTarget, setPresetTarget] = useState(defaultTarget);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState('');
  const [selectedRuleSets, setSelectedRuleSets] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const togglePreset = (id: string) => {
    setSelectedPresets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRuleSet = (name: string) => {
    setSelectedRuleSets((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = async (rules: string[]) => {
    if (!rules.length) {
      toast.error('没有可添加的规则');
      return;
    }
    setBusy(true);
    try {
      await onSave(rules);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const presetRules = [...selectedPresets].map((id) => {
    const preset = PRESETS.find((item) => item.id === id);
    return preset ? presetRule(preset, presetTarget) : '';
  }).filter(Boolean);

  const batchRules = batch
    .replace(String.fromCharCode(13), '')
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter(Boolean);

  const ruleSetRules = [...selectedRuleSets].map((name) => `RULE-SET,${name},${presetTarget}`);

  const saveManual = () => {
    if (draft.type !== 'MATCH' && !draft.value.trim()) {
      toast.error('请填写规则内容');
      return;
    }
    void submit([buildRule(draft)]);
  };

  return (
    <SideSheet title={initial ? '编辑规则' : '新增规则'} onClose={onClose}>
      {!initial ? (
        <div className="sheet-tabs">
          <button
            className={tab === 'presets' ? 'sheet-tab active' : 'sheet-tab'}
            type="button"
            onClick={() => setTab('presets')}
          >
            <Sparkles size={14} />
            内置规则
          </button>
          <button
            className={tab === 'manual' ? 'sheet-tab active' : 'sheet-tab'}
            type="button"
            onClick={() => setTab('manual')}
          >
            <PencilLine size={14} />
            手动
          </button>
          <button
            className={tab === 'batch' ? 'sheet-tab active' : 'sheet-tab'}
            type="button"
            onClick={() => setTab('batch')}
          >
            <ListPlus size={14} />
            批量
          </button>
          {ruleSets.length ? (
            <button
              className={tab === 'rulesets' ? 'sheet-tab active' : 'sheet-tab'}
              type="button"
              onClick={() => setTab('rulesets')}
            >
              <Layers size={14} />
              规则集
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === 'presets' ? (
        <div className="sheet-section">
          <label className="field">
            <span>统一目标</span>
            <Select
              value={presetTarget}
              options={targetOptions.map((value) => ({ value, label: value }))}
              onChange={setPresetTarget}
              ariaLabel="规则目标"
            />
          </label>
          <div className="preset-list">
            {PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className={`preset-row ${selectedPresets.has(preset.id) ? 'selected' : ''}`}
                onClick={() => togglePreset(preset.id)}
              >
                <span className="preset-check">
                  {selectedPresets.has(preset.id) ? <Check size={12} /> : null}
                </span>
                <span className="preset-main">
                  <strong>{preset.name}</strong>
                  <span>
                    {preset.type}
                    {preset.value ? ` · ${preset.value}` : ''}
                  </span>
                </span>
                {preset.hint ? <span className="chip chip-muted">{preset.hint}</span> : null}
              </button>
            ))}
          </div>
          <div className="sheet-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void submit(presetRules)}
              disabled={busy || !presetRules.length}
            >
              {presetRules.length ? `添加 ${presetRules.length} 条规则` : '添加规则'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'manual' ? (
        <div className="sheet-section">
          <div className="form-grid two">
            <label className="field">
              <span>类型</span>
              <Select
                value={draft.type}
                options={RULE_TYPES.map((value) => ({ value, label: value }))}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    type: value,
                    value: value === 'MATCH' ? '' : current.value,
                  }))
                }
                ariaLabel="规则类型"
              />
            </label>
            <label className="field">
              <span>目标</span>
              <Select
                value={draft.target}
                options={targetOptions.map((value) => ({ value, label: value }))}
                onChange={(value) => setDraft((current) => ({ ...current, target: value }))}
                ariaLabel="规则目标"
              />
            </label>
          </div>
          {draft.type !== 'MATCH' ? (
            <label className="field">
              <span>内容</span>
              <input
                className="input mono"
                value={draft.value}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, value: event.target.value }))
                }
                placeholder={
                  draft.type === 'GEOIP'
                    ? 'CN'
                    : draft.type === 'RULE-SET'
                      ? 'rule-set 名称'
                      : 'example.com'
                }
                spellCheck={false}
                autoFocus
              />
            </label>
          ) : null}
          {IP_TYPES.has(draft.type) ? (
            <label className="check">
              <input
                type="checkbox"
                checked={draft.noResolve}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, noResolve: event.target.checked }))
                }
              />
              no-resolve
            </label>
          ) : null}
          <div className="rule-preview">
            <span>预览</span>
            <code>{buildRule(draft)}</code>
          </div>
          <div className="sheet-actions">
            <button className="btn btn-primary" type="button" onClick={saveManual} disabled={busy}>
              {initial ? '保存规则' : '添加规则'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'batch' ? (
        <div className="sheet-section">
          <label className="field">
            <span>每行一条规则</span>
            <textarea
              className="textarea mono node-editor"
              value={batch}
              onChange={(event) => setBatch(event.target.value)}
              rows={12}
              placeholder={'DOMAIN-SUFFIX,openai.com,DIRECT' + String.fromCharCode(10) + 'GEOIP,CN,DIRECT' + String.fromCharCode(10) + 'MATCH,DIRECT'}
              spellCheck={false}
            />
          </label>
          <div className="sheet-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void submit(batchRules)}
              disabled={busy || !batchRules.length}
            >
              {batchRules.length ? `添加 ${batchRules.length} 条规则` : '添加规则'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'rulesets' ? (
        <div className="sheet-section">
          <label className="field">
            <span>目标</span>
            <Select
              value={presetTarget}
              options={targetOptions.map((value) => ({ value, label: value }))}
              onChange={setPresetTarget}
              ariaLabel="规则集目标"
            />
          </label>
          <div className="preset-list">
            {ruleSets.map((name) => (
              <button
                type="button"
                key={name}
                className={`preset-row ${selectedRuleSets.has(name) ? 'selected' : ''}`}
                onClick={() => toggleRuleSet(name)}
              >
                <span className="preset-check">
                  {selectedRuleSets.has(name) ? <Check size={12} /> : null}
                </span>
                <span className="preset-main">
                  <strong>{name}</strong>
                  <span>RULE-SET · {name}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="sheet-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void submit(ruleSetRules)}
              disabled={busy || !ruleSetRules.length}
            >
              {ruleSetRules.length ? `添加 ${ruleSetRules.length} 条规则` : '添加规则'}
            </button>
          </div>
        </div>
      ) : null}
    </SideSheet>
  );
}
