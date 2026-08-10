import { useEffect, useState } from "react";
import {
  ExternalLink,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type {
  ChromeProfileView,
  LocalShortcutView,
  PlatformCapabilities,
  SpaceListItem,
} from "../../../shared/contracts";
import { ConfirmModal, Modal } from "../components/Modal";
import { errorMessage } from "../ui";

const DEFAULT_CHATGPT_URL = "https://chatgpt.com/admin/members";

type PageProps = {
  refreshToken: number;
  platformCapabilities: PlatformCapabilities;
  onChanged: () => void;
  onError: (message: string) => void;
};

export function ShortcutsPage(props: PageProps) {
  const [items, setItems] = useState<LocalShortcutView[]>([]);
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [chromeProfiles, setChromeProfiles] = useState<ChromeProfileView[]>([]);
  const [editing, setEditing] = useState<LocalShortcutView | "new" | null>(null);
  const [creatingChrome, setCreatingChrome] = useState(false);
  const [deleting, setDeleting] = useState<LocalShortcutView | null>(null);
  const [detecting, setDetecting] = useState(false);

  const load = async () => {
    try {
      const [shortcuts, spaceRows, profiles] = await Promise.all([
        window.teamRental.listShortcuts(),
        window.teamRental.listSpaces(),
        props.platformCapabilities.chromeProfileShortcuts
          ? window.teamRental.listChromeProfiles()
          : Promise.resolve([]),
      ]);
      setItems(shortcuts);
      setSpaces(spaceRows);
      setChromeProfiles(profiles);
    } catch (error) {
      props.onError(errorMessage(error));
    }
  };

  useEffect(() => {
    void load();
  }, [props.refreshToken]);

  const changed = () => {
    void load();
    props.onChanged();
  };

  const refreshProfiles = async () => {
    setDetecting(true);
    try {
      setChromeProfiles(await window.teamRental.listChromeProfiles());
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setDetecting(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await window.teamRental.deleteShortcut(deleting.id);
      setDeleting(null);
      changed();
    } catch (error) {
      props.onError(errorMessage(error));
    }
  };

  return (
    <>
      <section className="section-heading">
        <div>
          <h2>快捷方式管理</h2>
          <p>{props.platformCapabilities.chromeProfileShortcuts ? "自动识别 Chrome 独立用户并创建跳转，也可以绑定已有快捷方式或程序。" : "绑定并集中打开当前平台支持的快捷方式或程序。"}</p>
        </div>
        <div className="action-row">
          <button
            className="button secondary"
            onClick={() => setEditing("new")}
          >
            绑定已有文件
          </button>
          {props.platformCapabilities.chromeProfileShortcuts ? <button
              className="button primary"
              onClick={() => setCreatingChrome(true)}
            >
              <Plus size={17} />
              从 Chrome 自动创建
            </button> : null}
        </div>
      </section>

      {props.platformCapabilities.chromeProfileShortcuts ? <section className="shortcut-feature-card">
        <div className="row-icon shortcut-feature-icon">
          <Link2 size={21} />
        </div>
        <div className="grow">
          <div className="shortcut-feature-title">
            <strong>已识别 {chromeProfiles.length} 个 Chrome 独立用户</strong>
            <span className="status-badge normal">自动识别</span>
          </div>
          <p>
            这里识别的是 Chrome 用户（个人资料），不是浏览器窗口或标签页。选择一个用户后，
            软件会自动生成固定使用该用户并打开指定网址的 Windows 快捷方式。
          </p>
          <small>
            对应 Chrome 用户已经登录时可直接进入账号环境；软件不会读取或绕过账号密码、验证码和平台安全检查。
          </small>
        </div>
        <button
          className="button secondary"
          onClick={() => void refreshProfiles()}
          disabled={detecting}
        >
          <RefreshCw size={16} className={detecting ? "spin" : undefined} />
          {detecting ? "识别中…" : "重新识别"}
        </button>
      </section> : null}

      <section className="list-card">
        {items.length === 0 ? (
          <div className="empty-inline">还没有快捷方式</div>
        ) : (
          items.map((item) => (
            <div className="list-row" key={item.id}>
              <div className="row-icon">
                <Link2 size={19} />
              </div>
              <div className="grow">
                <strong>{item.label}</strong>
                <small>{item.targetPath}</small>
              </div>
              <span
                className={
                  item.available
                    ? "status-badge normal"
                    : "status-badge overdue"
                }
              >
                {item.available ? "可用" : "原文件不存在"}
              </span>
              <div className="action-row">
                <button
                  className="icon-button success"
                  title="打开"
                  aria-label={`打开快捷方式 ${item.label}`}
                  onClick={() =>
                    window.teamRental
                      .openShortcut(item.id)
                      .catch((error) => props.onError(errorMessage(error)))
                  }
                >
                  <ExternalLink size={17} />
                </button>
                <button
                  className="icon-button"
                  title="编辑"
                  aria-label={`编辑快捷方式 ${item.label}`}
                  onClick={() => setEditing(item)}
                >
                  <Pencil size={17} />
                </button>
                <button
                  className="icon-button danger-text"
                  title="解绑"
                  aria-label={`解绑快捷方式 ${item.label}`}
                  onClick={() => setDeleting(item)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {creatingChrome && props.platformCapabilities.chromeProfileShortcuts ? (
        <ChromeShortcutForm
          profiles={chromeProfiles}
          spaces={spaces}
          onClose={() => setCreatingChrome(false)}
          onSaved={changed}
          onError={props.onError}
        />
      ) : null}
      {editing ? (
        <ShortcutForm
          item={editing === "new" ? null : editing}
          spaces={spaces}
          onClose={() => setEditing(null)}
          onSaved={changed}
          onError={props.onError}
        />
      ) : null}
      {deleting ? (
        <ConfirmModal
          title="解绑快捷方式"
          message={`只删除 Team 出租管理里的绑定，不会删除原文件“${deleting.label}”。`}
          confirmLabel="确认解绑"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}

function recommendedProfile(
  profiles: readonly ChromeProfileView[],
): ChromeProfileView | undefined {
  return profiles.find((profile) => profile.directory !== "Default") ?? profiles[0];
}

function ChromeShortcutForm(props: {
  profiles: ChromeProfileView[];
  spaces: SpaceListItem[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const initialProfile = recommendedProfile(props.profiles);
  const [profileDirectory, setProfileDirectory] = useState(
    initialProfile?.directory ?? "",
  );
  const [label, setLabel] = useState(initialProfile?.displayName ?? "");
  const [url, setUrl] = useState(DEFAULT_CHATGPT_URL);
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState(false);

  const selectProfile = (directory: string) => {
    setProfileDirectory(directory);
    const profile = props.profiles.find((item) => item.directory === directory);
    if (profile) setLabel(profile.displayName);
  };

  const create = async () => {
    setBusy(true);
    try {
      await window.teamRental.createChromeShortcut({
        label,
        profileDirectory,
        url,
        spaceId: spaceId || null,
      });
      props.onSaved();
      props.onClose();
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="从 Chrome 自动创建快捷方式"
      description="选择电脑中已有的 Chrome 独立用户，软件会创建对应的 Windows 快捷方式。"
      onClose={props.onClose}
      closeDisabled={busy}
      footer={
        <>
          <button
            className="button secondary"
            onClick={props.onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              !profileDirectory ||
              !label.trim() ||
              !url.trim()
            }
            onClick={() => void create()}
          >
            {busy ? "创建中…" : "创建并保存"}
          </button>
        </>
      }
    >
      <div className="stack-form">
        {props.profiles.length > 0 ? (
          <div className="shortcut-detection-note">
            已检测到 {props.profiles.length} 个 Chrome 用户。选择后会固定使用该用户打开下面的网址。
          </div>
        ) : (
          <div className="shortcut-detection-note warning">
            未检测到标准 Chrome 用户。请先在 Chrome 中添加独立用户，或返回使用“绑定已有文件”。
          </div>
        )}
        <label>
          Chrome 独立用户
          <select
            value={profileDirectory}
            onChange={(event) => selectProfile(event.target.value)}
            disabled={busy || props.profiles.length === 0}
          >
            <option value="">请选择 Chrome 用户</option>
            {props.profiles.map((profile) => (
              <option key={profile.directory} value={profile.directory}>
                {profile.displayName}
                {profile.account ? ` · ${profile.account}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          快捷方式名称
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="例如：1110 ChatGPT"
            disabled={busy}
          />
        </label>
        <label>
          打开网址
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          关联空间（可选）
          <select
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
            disabled={busy}
          >
            <option value="">不关联</option>
            {props.spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.displayName}
              </option>
            ))}
          </select>
        </label>
        <p className="shortcut-security-note">
          只要该 Chrome 用户中的登录状态仍有效，打开快捷方式时通常无需再次输入账号密码；
          登录失效或平台要求验证时，仍需在 Chrome 中正常登录。若以后删除了该 Chrome 用户，
          旧快捷方式不会改用默认用户；请在本页重新识别并创建新的快捷方式。
        </p>
      </div>
    </Modal>
  );
}

function ShortcutForm(props: {
  item: LocalShortcutView | null;
  spaces: SpaceListItem[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [label, setLabel] = useState(props.item?.label ?? "");
  const [targetPath, setTargetPath] = useState(props.item?.targetPath ?? "");
  const [spaceId, setSpaceId] = useState(props.item?.spaceId ?? "");
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    const path = await window.teamRental.chooseShortcutTarget();
    if (path) {
      setTargetPath(path);
      if (!label) {
        setLabel(
          path
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.[^.]+$/, "") ?? "",
        );
      }
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await window.teamRental.saveShortcut({
        id: props.item?.id,
        label,
        targetPath,
        spaceId: spaceId || null,
      });
      props.onSaved();
      props.onClose();
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={props.item ? "编辑快捷方式" : "绑定已有文件"}
      onClose={props.onClose}
      closeDisabled={busy}
      footer={
        <>
          <button
            className="button secondary"
            onClick={props.onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            className="button primary"
            disabled={busy || !label || !targetPath}
            onClick={() => void save()}
          >
            保存
          </button>
        </>
      }
    >
      <div className="stack-form">
        <label>
          显示名称
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label>
          绑定文件
          <div className="input-action">
            <input readOnly value={targetPath} />
            <button
              className="button secondary"
              onClick={() => void choose()}
              disabled={busy}
            >
              选择
            </button>
          </div>
        </label>
        <label>
          关联空间（可选）
          <select
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
          >
            <option value="">不关联</option>
            {props.spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}
