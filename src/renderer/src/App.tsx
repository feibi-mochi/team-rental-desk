import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CircleGauge,
  Coins,
  ExternalLink,
  History,
  Settings,
  UsersRound,
  X,
} from "lucide-react";
import type { AppBootstrap, NavigationSection } from "../../shared/contracts";
import { BrandMark } from "./components/BrandMark";
import { PasswordInput } from "./components/PasswordInput";
import { ThemePicker } from "./components/ThemePicker";
import { CurrenciesPage } from "./pages/CurrenciesPage";
import { ArchivedChildrenPage } from "./pages/ArchivedChildrenPage";
import { ArchivedSpacesPage } from "./pages/ArchivedSpacesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PaymentMethodsPage } from "./pages/PaymentMethodsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import { SpacesPage } from "./pages/SpacesPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { applyPalette, errorMessage } from "./ui";

const NAV_ITEMS: Array<{ key: NavigationSection; label: string; icon: typeof CircleGauge }> = [
  { key: "dashboard", label: "运营概览", icon: CircleGauge },
  { key: "spaces", label: "空间", icon: UsersRound },
  { key: "archived_spaces", label: "已归档空间", icon: Archive },
  { key: "archived_children", label: "子位置归档", icon: ArchiveRestore },
  { key: "transactions", label: "账务流水", icon: History },
  { key: "shortcuts", label: "快捷方式", icon: ExternalLink },
  { key: "channels", label: "支付渠道", icon: Banknote },
  { key: "currencies", label: "币种汇率", icon: Coins },
  { key: "settings", label: "设置", icon: Settings },
];

function initialNavigationSection(): NavigationSection {
  const requested = new URLSearchParams(window.location.search).get("previewSection");
  return NAV_ITEMS.some((item) => item.key === requested) ? requested as NavigationSection : "dashboard";
}

export function App() {
  const [auth, setAuth] = useState<"checking" | "setup" | "locked" | "unlocked">("checking");
  const [section, setSection] = useState<NavigationSection>(initialNavigationSection);
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [palette, setPalette] = useState("teal");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const value = Number(localStorage.getItem("team-rental-sidebar-width") ?? "224");
    return Number.isFinite(value) && value >= 190 && value <= 360 ? value : 224;
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const [focusedSpaceId, setFocusedSpaceId] = useState<string | null>(null);
  const dragging = useRef(false);
  const sidebarWidthRef = useRef(sidebarWidth);

  useEffect(() => {
    window.teamRental.authStatus()
      .then((status) => setAuth(status.unlocked ? "unlocked" : status.requiresPasswordSetup ? "setup" : "locked"))
      .catch((reason: unknown) => { setError(errorMessage(reason)); setAuth("locked"); });
  }, []);

  useEffect(() => {
    if (auth !== "unlocked") return;
    window.teamRental.bootstrap().then((data) => {
      setBootstrap(data);
      setPalette(data.palette);
      applyPalette(data.palette);
      localStorage.setItem("team-rental-palette", data.palette);
    }).catch((reason: unknown) => setError(errorMessage(reason)));
  }, [auth]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7_000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      const next = Math.max(190, Math.min(360, event.clientX));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.classList.remove("resizing");
      localStorage.setItem("team-rental-sidebar-width", String(sidebarWidthRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  const changePalette = (key: string) => {
    setPalette(key);
    applyPalette(key);
    localStorage.setItem("team-rental-palette", key);
    void window.teamRental.savePalette(key).catch((reason) => setError(errorMessage(reason)));
    setPaletteOpen(false);
  };
  const changed = () => setRefreshToken((value) => value + 1);
  const navigate = (next: NavigationSection) => {
    if (next === "spaces") setFocusedSpaceId(null);
    setSection(next);
  };
  const openSpace = (spaceId: string) => {
    setFocusedSpaceId(spaceId);
    setSection("spaces");
  };
  const common = { refreshToken, onChanged: changed, onError: setError };
  const page = (() => {
    switch (section) {
      case "dashboard": return <DashboardPage refreshToken={refreshToken} onChanged={changed} onError={setError} onNotice={setNotice} onNavigate={navigate} onOpenSpace={openSpace} />;
      case "spaces": return <SpacesPage {...common} focusedSpaceId={focusedSpaceId} />;
      case "archived_spaces": return <ArchivedSpacesPage {...common} />;
      case "archived_children": return <ArchivedChildrenPage {...common} />;
      case "transactions": return <TransactionsPage {...common} onNotice={setNotice} />;
      case "shortcuts": return <ShortcutsPage {...common} platformCapabilities={bootstrap?.platformCapabilities ?? {chromeProfileShortcuts:true,nativeNotifications:true,startupCheck:true}} />;
      case "channels": return <PaymentMethodsPage {...common} />;
      case "currencies": return <CurrenciesPage {...common} onNotice={setNotice} />;
      case "settings": return <SettingsPage databasePath={bootstrap?.database.path ?? ""} platformCapabilities={bootstrap?.platformCapabilities ?? {chromeProfileShortcuts:true,nativeNotifications:true,startupCheck:true}} {...common} onNotice={setNotice} />;
    }
  })();

  if (auth !== "unlocked") {
    return <LockScreen checking={auth === "checking"} setup={auth === "setup"} onUnlocked={() => setAuth("unlocked")} />;
  }

  return (
    <div className="app-shell" style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><BrandMark size={44} /></div>
          <div className="brand-copy"><strong>Team 出租管理</strong><span>本地运营台</span></div>
          <ThemePicker current={palette} open={paletteOpen} onToggle={() => setPaletteOpen((value) => !value)} onSelect={changePalette} />
        </div>
        <nav>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return <button key={item.key} className={section === item.key ? "nav-item active" : "nav-item"} onClick={() => { navigate(item.key); setPaletteOpen(false); }}><Icon size={19} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sidebar-footer"><span>仅本机访问</span><strong>{bootstrap ? "数据已连接" : "正在连接"}</strong><small>v{bootstrap?.appVersion ?? "—"}</small></div>
        <div
          className="sidebar-resizer"
          title="拖动或使用左右方向键调整侧栏宽度"
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={190}
          aria-valuemax={360}
          aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={0}
          onPointerDown={(event) => { dragging.current = true; document.body.classList.add("resizing"); event.currentTarget.setPointerCapture(event.pointerId); }}
          onKeyDown={(event) => {
            let next = sidebarWidthRef.current;
            if (event.key === "ArrowLeft") next -= 10;
            else if (event.key === "ArrowRight") next += 10;
            else if (event.key === "Home") next = 190;
            else if (event.key === "End") next = 360;
            else return;
            event.preventDefault();
            next = Math.max(190, Math.min(360, next));
            sidebarWidthRef.current = next;
            setSidebarWidth(next);
            localStorage.setItem("team-rental-sidebar-width", String(next));
          }}
        />
      </aside>
      <main className="content">
        <header className="page-header"><div><p className="eyebrow">TEAM RENTAL / WINDOWS</p><h1>{NAV_ITEMS.find((item) => item.key === section)?.label}</h1></div></header>
        {error ? <section className="notice error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={17} /></button></section> : null}
        {notice ? <section className="notice success" role="status"><span>{notice}</span><button className="icon-button" aria-label="关闭成功提示" onClick={() => setNotice(null)}><X size={17} /></button></section> : null}
        <div className="page-body">{page}</div>
      </main>
    </div>
  );
}

function LockScreen(props: { checking: boolean; setup: boolean; onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    if (props.setup && password !== confirmPassword) { setMessage("两次输入的新密码不一致"); return; }
    setBusy(true);
    setMessage("");
    try {
      const status = props.setup
        ? await window.teamRental.setupPassword(password)
        : await window.teamRental.unlock(password);
      setPassword("");
      setConfirmPassword("");
      if (status.unlocked) props.onUnlocked();
      else setMessage(status.retryAfterSeconds > 0 ? `尝试次数过多，请 ${status.retryAfterSeconds} 秒后再试` : "密码不正确");
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return <main className="lock-screen"><section className="lock-card">
    <div className="lock-brand"><div className="brand-icon"><BrandMark size={54}/></div><div><p className="eyebrow">TEAM RENTAL / LOCAL</p><h1>Team 出租管理</h1></div></div>
    <p>{props.setup ? "首次使用需要设置一个本机登录密码。密码只用于保护这台电脑上的管理界面。" : "请输入本机登录密码。账号资料和收款数据只保存在这台电脑。"}</p>
    {props.checking ? <div className="lock-checking">正在连接本地数据…</div> : <form onSubmit={submit}><label>{props.setup ? "设置新密码" : "登录密码"}<PasswordInput autoFocus value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={props.setup ? "new-password" : "current-password"} /></label>{props.setup ? <label>再次输入新密码<PasswordInput value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label> : null}{message ? <span className="lock-error">{message}</span> : null}<button className="button primary" disabled={busy || !password || (props.setup && !confirmPassword)}>{busy ? "正在保存…" : props.setup ? "保存密码并进入" : "进入管理台"}</button></form>}
  </section></main>;
}
