import { useEffect, useState } from "react";
import { BellRing, DatabaseBackup, FolderOpen, HardDriveDownload, KeyRound, MailCheck, Save, Send } from "lucide-react";
import type { BackupSettings, PlatformCapabilities, ReminderGroupSettings, ReminderSettings, SecuritySettings } from "../../../shared/contracts";
import { ConfirmModal } from "../components/Modal";
import { PasswordInput } from "../components/PasswordInput";
import { errorMessage } from "../ui";

function Toggle(props:{checked:boolean;onChange:(checked:boolean)=>void;label:string;description:string}){
  return <label className="toggle-row"><div><strong>{props.label}</strong><span>{props.description}</span></div><input type="checkbox" checked={props.checked} onChange={(e)=>props.onChange(e.target.checked)}/><i/></label>;
}

const EMPTY_GROUP: ReminderGroupSettings = {
  enabled:false,scheduledEnabled:false,startupCheckEnabled:false,repeatSameDayEnabled:false,
  recipientEmail:"",sendTime:"08:00",thresholdDays:5,smtpUrl:"",smtpFrom:"",
  templateSubject:"Team 出租管理｜{{count}} 个到期提醒",templateBody:"请及时处理到期事项。",
};

export function SettingsPage(props:{databasePath:string;platformCapabilities:PlatformCapabilities;refreshToken:number;onChanged:()=>void;onError:(message:string)=>void;onNotice:(message:string)=>void}){
  const [security,setSecurity]=useState<SecuritySettings>({requirePasswordOnStartup:true,passwordUsesLegacyHash:false});
  const [passwords,setPasswords]=useState({current:"",next:"",confirm:""});
  const [backup,setBackup]=useState<BackupSettings>({directory:"",onClose:true,intervalEnabled:true,intervalMinutes:60,retentionCount:30});
  const [reminders,setReminders]=useState<ReminderSettings>({loginStartupCheckEnabled:false,windowsNotificationEnabled:true,space:{...EMPTY_GROUP},child:{...EMPTY_GROUP}});
  const [legacyPath,setLegacyPath]=useState("");const [confirmImport,setConfirmImport]=useState(false);const [busy,setBusy]=useState<string|null>(null);
  const load=async()=>{try{const [securitySettings,backupSettings,reminderSettings]=await Promise.all([window.teamRental.getSecuritySettings(),window.teamRental.getBackupSettings(),window.teamRental.getReminderSettings()]);setSecurity(securitySettings);setBackup(backupSettings);setReminders(reminderSettings)}catch(error){props.onError(errorMessage(error))}};
  useEffect(()=>{void load()},[props.refreshToken]);
  const chooseBackup=async()=>{const directory=await window.teamRental.chooseBackupDirectory();if(directory)setBackup({...backup,directory})};
  const saveBackup=async()=>{setBusy("backup-save");try{await window.teamRental.saveBackupSettings(backup);props.onNotice("备份设置已保存");props.onChanged()}catch(error){props.onError(errorMessage(error))}finally{setBusy(null)}};
  const runBackup=async()=>{setBusy("backup-run");try{await window.teamRental.saveBackupSettings(backup);const result=await window.teamRental.runBackup();props.onNotice(`备份成功：${result.directory}`);props.onChanged()}catch(error){props.onError(errorMessage(error))}finally{setBusy(null)}};
  const saveSecurity=async()=>{setBusy("security");try{await window.teamRental.saveSecuritySettings(security);props.onNotice(security.requirePasswordOnStartup?"已开启：下次启动需要输入密码":"已关闭：下次启动将直接进入管理台");props.onChanged()}catch(error){props.onError(errorMessage(error))}finally{setBusy(null)}};
  const changePassword=async()=>{if(passwords.next!==passwords.confirm){props.onError("两次输入的新密码不一致");return}setBusy("password");try{await window.teamRental.changePassword(passwords.current,passwords.next);setPasswords({current:"",next:"",confirm:""});props.onNotice("登录密码已更新");await load()}catch(error){props.onError(errorMessage(error))}finally{setBusy(null)}};
  const chooseLegacy=async()=>{const path=await window.teamRental.chooseLegacyDatabase();if(path)setLegacyPath(path)};
  const importLegacy=async()=>{setBusy("import");try{const result=await window.teamRental.importLegacyDatabase(legacyPath);setConfirmImport(false);props.onNotice(`导入完成：${result.spaces} 个空间、${result.childSeats} 个子位置、${result.receipts} 条收款；导入前备份在 ${result.backupDirectory}`);props.onChanged()}catch(error){props.onError(errorMessage(error))}finally{setBusy(null)}};
  const saveReminders=async()=>{setBusy("reminders");try{await window.teamRental.saveReminderSettings(reminders);props.onNotice("提醒设置已保存");props.onChanged()}catch(error){props.onError(errorMessage(error))}finally{setBusy(null)}};
  const testMail=async(kind:"space"|"child")=>{setBusy(`test-${kind}`);try{await window.teamRental.saveReminderSettings(reminders);await window.teamRental.sendTestReminder(kind);props.onNotice("测试邮件已发送，请稍等片刻并检查垃圾邮件") }catch(error){props.onError(errorMessage(error))}finally{setBusy(null)}};
  const testWindowsNotification=async()=>{setBusy("test-windows");try{await window.teamRental.sendTestWindowsNotification();props.onNotice("测试通知已发送到屏幕右下角") }catch(error){props.onError(errorMessage(error))}finally{setBusy(null)}};
  return <><section className="section-heading"><div><h2>设置</h2><p>登录保护、备份、旧数据迁移、开机自检和邮件提醒集中在这里。</p></div></section>
    <section className="settings-card"><header><div className="settings-icon"><KeyRound size={21}/></div><div><h3>登录保护</h3><p>控制这台电脑每次重新打开 Team 出租管理时是否需要验证密码。</p></div></header><div className="settings-body">
      <Toggle checked={security.requirePasswordOnStartup} onChange={(value)=>setSecurity({...security,requirePasswordOnStartup:value})} label="每次打开都需要输入密码" description={security.requirePasswordOnStartup?"重新启动程序后进入密码页。":"下次启动会直接进入管理台，仅建议个人电脑使用。"}/>
      <button className="button primary" onClick={saveSecurity} disabled={busy!==null}><Save size={17}/>{busy==="security"?"保存中…":"保存登录设置"}</button>
      <div className="reminder-editor"><div className="reminder-title"><div><KeyRound size={18}/><strong>修改登录密码</strong></div>{security.passwordUsesLegacyHash?<span className="status-badge soon">建议升级</span>:null}</div><div className="form-grid"><label>当前密码<PasswordInput value={passwords.current} onChange={(e)=>setPasswords({...passwords,current:e.target.value})} autoComplete="current-password"/></label><label>新密码<PasswordInput value={passwords.next} onChange={(e)=>setPasswords({...passwords,next:e.target.value})} autoComplete="new-password"/></label><label>再次输入新密码<PasswordInput value={passwords.confirm} onChange={(e)=>setPasswords({...passwords,confirm:e.target.value})} autoComplete="new-password"/></label></div><button className="button secondary" onClick={changePassword} disabled={busy!==null||!passwords.current||!passwords.next||!passwords.confirm}><KeyRound size={16}/>{busy==="password"?"修改中…":"修改密码"}</button></div>
    </div></section>
    <section className="settings-card"><header><div className="settings-icon"><DatabaseBackup size={21}/></div><div><h3>数据备份</h3><p>立即备份、关闭时备份和间隔备份可以同时开启，也可以全部关闭。</p></div></header><div className="settings-body">
      <label>备份保存路径<div className="input-action"><input value={backup.directory} readOnly/><button className="button secondary" onClick={chooseBackup}><FolderOpen size={16}/>更改路径</button></div></label>
      <Toggle checked={backup.onClose} onChange={(value)=>setBackup({...backup,onClose:value})} label="关闭程序后自动备份" description="窗口关闭时完成备份，再彻底退出。"/>
      <Toggle checked={backup.intervalEnabled} onChange={(value)=>setBackup({...backup,intervalEnabled:value})} label="按间隔自动备份" description="只在 Team 出租管理运行期间执行。"/>
      {backup.intervalEnabled?<label className="short-field">备份间隔（分钟）<input type="number" min="5" max="43200" value={backup.intervalMinutes} onChange={(e)=>setBackup({...backup,intervalMinutes:Number(e.target.value)})}/></label>:null}
      <label className="short-field">最多保留备份数量<input type="number" min="3" max="100" value={backup.retentionCount} onChange={(e)=>setBackup({...backup,retentionCount:Number(e.target.value)})}/></label>
      <div className="button-row"><button className="button primary" onClick={runBackup} disabled={busy!==null}><DatabaseBackup size={17}/>{busy==="backup-run"?"备份中…":"立即备份"}</button><button className="button secondary" onClick={saveBackup} disabled={busy!==null}><Save size={17}/>保存设置</button></div>
      <small>当前数据库：{props.databasePath}。备份会隐藏邮件 SMTP 授权信息，恢复后需重新填写。</small>
    </div></section>
    <section className="settings-card"><header><div className="settings-icon"><HardDriveDownload size={21}/></div><div><h3>导入旧版数据</h3><p>只读打开旧版 app.db，导入前先备份当前数据；旧数据库不会被修改。</p></div></header><div className="settings-body"><div className="input-action"><input value={legacyPath} readOnly placeholder="请选择旧版 app.db 文件"/><button className="button secondary" onClick={chooseLegacy}><FolderOpen size={16}/>选择旧库</button></div><button className="button primary" disabled={!legacyPath||busy!==null} onClick={()=>setConfirmImport(true)}>开始导入</button></div></section>
    <section className="settings-card"><header><div className="settings-icon"><BellRing size={21}/></div><div><h3>{props.platformCapabilities.startupCheck?"开机与邮件提醒":"邮件提醒"}</h3><p>{props.platformCapabilities.startupCheck?"开机自检和运行时定时邮件互不冲突。同一天是否允许重复，也可以自由选择。":"当前平台适配器尚未提供开机自检；程序运行时仍可按计划发送邮件。"}</p></div></header><div className="settings-body">
      {props.platformCapabilities.startupCheck?<Toggle checked={reminders.loginStartupCheckEnabled} onChange={(value)=>setReminders({...reminders,loginStartupCheckEnabled:value})} label="Windows 登录时自动自检" description="检查、发送和通知完成后自动退出，不打开管理窗口。"/>:null}
      {props.platformCapabilities.nativeNotifications?<><Toggle checked={reminders.windowsNotificationEnabled} onChange={(value)=>setReminders({...reminders,windowsNotificationEnabled:value})} label="开机自检显示 Windows 通知" description="没有到期事项时不弹出。"/><button className="button secondary" onClick={testWindowsNotification} disabled={busy!==null}><BellRing size={16}/>{busy==="test-windows"?"通知中…":"测试右下角 Windows 通知"}</button></>:null}
      <ReminderEditor title="空间邮件提醒" value={reminders.space} onChange={(space)=>setReminders({...reminders,space})} onTest={()=>testMail("space")} testing={busy==="test-space"} startupCheckSupported={props.platformCapabilities.startupCheck}/>
      <ReminderEditor title="子位置邮件提醒" value={reminders.child} onChange={(child)=>setReminders({...reminders,child})} onTest={()=>testMail("child")} testing={busy==="test-child"} startupCheckSupported={props.platformCapabilities.startupCheck}/>
      <button className="button primary" onClick={saveReminders} disabled={busy!==null}><Save size={17}/>{busy==="reminders"?"保存中…":"保存全部提醒设置"}</button>
    </div></section>
    {confirmImport?<ConfirmModal title="导入旧版数据" message="只能导入到空白数据库。程序会先备份当前数据，再复制旧版空间、账号、收款、渠道、汇率和提醒设置；旧版不会被修改。确认继续吗？" confirmLabel="确认导入" busy={busy==="import"} onClose={()=>setConfirmImport(false)} onConfirm={importLegacy}/>:null}
  </>;
}

function ReminderEditor(props:{title:string;value:ReminderGroupSettings;onChange:(value:ReminderGroupSettings)=>void;onTest:()=>void;testing:boolean;startupCheckSupported:boolean}){
  const set=<K extends keyof ReminderGroupSettings>(key:K,value:ReminderGroupSettings[K])=>props.onChange({...props.value,[key]:value});
  return <div className="reminder-editor"><div className="reminder-title"><div><MailCheck size={18}/><strong>{props.title}</strong></div><label className="mini-switch"><input type="checkbox" checked={props.value.enabled} onChange={(e)=>set("enabled",e.target.checked)}/><i/></label></div>
    <div className="reminder-options">{props.startupCheckSupported?<Toggle checked={props.value.startupCheckEnabled} onChange={(value)=>set("startupCheckEnabled",value)} label="开机自检时发送" description="与定时发送可同时开启。"/>:null}<Toggle checked={props.value.scheduledEnabled} onChange={(value)=>set("scheduledEnabled",value)} label="程序运行时定时发送" description="程序关闭时不会发送。"/><Toggle checked={props.value.repeatSameDayEnabled} onChange={(value)=>set("repeatSameDayEnabled",value)} label="允许同一天重复发送" description="关闭时，同一事项当天只发一次。"/></div>
    <div className="form-grid"><label>接收邮箱<input value={props.value.recipientEmail} onChange={(e)=>set("recipientEmail",e.target.value)}/></label><label>发送时间<input type="time" value={props.value.sendTime} onChange={(e)=>set("sendTime",e.target.value)}/></label><label>提前提醒天数<input type="number" min="0" max="90" value={props.value.thresholdDays} onChange={(e)=>set("thresholdDays",Number(e.target.value))}/></label><label>发件邮箱<input value={props.value.smtpFrom} onChange={(e)=>set("smtpFrom",e.target.value)}/></label><label className="span-2">SMTP URL<PasswordInput value={props.value.smtpUrl} onChange={(e)=>set("smtpUrl",e.target.value)} placeholder="smtps://邮箱:授权码@smtp.example.com:465"/></label><label className="span-2">邮件标题<input value={props.value.templateSubject} onChange={(e)=>set("templateSubject",e.target.value)}/></label><label className="span-2">邮件说明<textarea rows={2} value={props.value.templateBody} onChange={(e)=>set("templateBody",e.target.value)}/></label></div>
    <button className="button secondary" disabled={props.testing} onClick={props.onTest}><Send size={16}/>{props.testing?"发送中…":"发送测试邮件"}</button>
  </div>;
}
