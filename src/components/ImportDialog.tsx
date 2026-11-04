import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  clashVergeProfiles,
  errorMessage,
  importClashVerge,
  importSource,
  isTauriRuntime,
} from '../api';
import type { VergeProfile } from '../api';
import { Dialog } from '../components/Dialog';
import { Select } from './Select';
import { useImportDialog } from '../store/dialogs';
import { toast } from '../store/toast';
import { useWorkspaceData } from '../store/workspace';

export function ImportDialog() {
  const open = useImportDialog((state) => state.open);
  const hide = useImportDialog((state) => state.hide);
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [vergeProfiles, setVergeProfiles] = useState<VergeProfile[]>([]);
  const [vergeUid, setVergeUid] = useState('');
  const [vergeBusy, setVergeBusy] = useState(false);
  const browser = !isTauriRuntime();

  if (!open) return null;

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await importSource(input.trim());
      await useWorkspaceData.getState().load();
      if (next.addedNodes || next.addedExits || next.addedRules) {
        toast.success(
          `已导入 ${next.addedNodes} 个节点 / ${next.addedExits} 个出口 / ${next.addedRules} 条规则`,
        );
      }
      if (next.errors.length) {
        const preview = next.errors.slice(0, 2).join('；');
        toast.error(
          next.errors.length > 2
            ? `${next.errors.length} 项导入失败：${preview}…`
            : `导入失败：${preview}`,
        );
      }
      hide();
      navigate('/nodes');
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const loadVerge = async () => {
    setVergeBusy(true);
    try {
      const view = await clashVergeProfiles();
      if (!view.profiles.length) {
        toast.error('未找到 Clash Verge 订阅文件');
        return;
      }
      setVergeProfiles(view.profiles);
      setVergeUid((view.profiles.find((item) => item.current) ?? view.profiles[0]).uid);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setVergeBusy(false);
    }
  };

  const importVerge = async () => {
    if (!vergeUid) return;
    setVergeBusy(true);
    try {
      const result = await importClashVerge(vergeUid);
      await useWorkspaceData.getState().load();
      toast.success(
        `已导入 Clash Verge「${result.profile}」：${result.status.nodeCount} 个节点 / ${result.status.exitCount} 个出口 / ${result.status.ruleCount} 条规则`,
      );
      if (result.controllerSet) toast.info(`已自动配置控制器 ${result.controllerSet}`);
      hide();
      navigate('/nodes');
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setVergeBusy(false);
    }
  };

  return (
    <Dialog title="导入" onClose={hide}>
      <form onSubmit={handleImport}>
        <div className="dialog-body">
          <label className="field">
            <textarea
              className="textarea mono node-editor"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={'每行一项，支持混合批量：\nD:\\path\\to\\config.yaml\nhttps://example.com/subscribe\nss://… vmess://… trojan://…\n或直接粘贴 mihomo YAML'}
              rows={8}
              spellCheck={false}
              autoFocus
            />
          </label>
          <div className="inline-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void loadVerge()}
              disabled={browser || vergeBusy}
            >
              从 Clash Verge 读取
            </button>
          </div>
          {vergeProfiles.length ? (
            <div className="form-grid two">
              <label className="field">
                <span>Clash Verge 订阅</span>
                <Select
                  value={vergeUid}
                  options={vergeProfiles.map((item) => ({
                    value: item.uid,
                    label: item.current ? `${item.name}（当前）` : item.name,
                  }))}
                  onChange={setVergeUid}
                  ariaLabel="Clash Verge 订阅"
                />
              </label>
              <div className="field">
                <span>&nbsp;</span>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void importVerge()}
                  disabled={vergeBusy}
                >
                  {vergeBusy ? '导入中…' : '导入所选订阅'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="dialog-foot">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || browser || !input.trim()}
          >
            {busy ? '导入中…' : '导入'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={hide}>
            关闭
          </button>
        </div>
      </form>
    </Dialog>
  );
}
