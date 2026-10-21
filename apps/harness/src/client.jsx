import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { Button, Menu, Tag, StateDot, Tooltip, FileTypeIcon, fileSizeText,
  IconChevronLeftOutlineRegular as ArrowLeft, IconChevronRightOutlineRegular as ArrowRight,
  IconChevronDownOutlineRegular as ChevronDown, IconCheckOutlineRegular as Check,
  IconClockOutlineRegular as History, IconDarkOutlineRegular as Moon,
  IconPanelLeftOutlineRegular as PanelLeft, IconPlusOutlineRegular as Plus,
  IconSparkleRegular as Sparkles, IconLightOutlineRegular as Sun,
  IconPaperclipOutlineRegular as Upload, IconCloseOutlineRegular as X,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { BrandMark } from '@/components/brand/brand-mark';
import themeCss, { tokens } from 'youdub:theme';
import css from './style.css';
export const inject = ['slots', 'layout', 'theme'];
const labels = { imported: '待识别', recognizing: '正在识别', awaiting_review: '待人工确认', confirmed: '已确认', exporting: '正在导出', exported: '已导出', failed: '执行失败' };
const tones = { imported:'neutral', recognizing:'info', awaiting_review:'warning', confirmed:'success', exporting:'info', exported:'success', failed:'danger' };
const languages = [{id:'auto',label:'自动检测'},{id:'en',label:'英语'},{id:'zh',label:'中文'},{id:'ja',label:'日语'}];
const time = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${(ms / 1000 % 60).toFixed(2).padStart(5, '0')}`;
const selectedTask = state => state.tasks.find(t => t.id === state.selected);
const isDirty = state => Boolean(selectedTask(state)?.transcript && state.draft.some((s, i) => s.text !== selectedTask(state).transcript.segments[i]?.text));
const blocked = state => state.busy || isDirty(state);
const draftFor = task => task?.transcript?.segments.map(s => ({ id:s.id, text:s.text })) || [];
async function api(path, options) {
  const response = await fetch(`/api/youdub/${path}`, options);
  if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || `请求失败 (${response.status})`); }
  return response;
}
const post = (path, body) => api(path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
function IconButton({ label, children, ...props }) {
  return <Tooltip label={label} portal><Button className="yd-icon-button" aria-label={label} {...props}>{children}</Button></Tooltip>;
}
function Status({ status }) { return <Tag tone={tones[status]}>{labels[status]}</Tag>; }
function Language({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  return <div className="yd-language"><span>识别语言</span><Menu open={open} portal selectedId={value} items={languages}
    onClose={() => setOpen(false)} onSelect={id => { onChange(id); setOpen(false); }}
    anchor={<Button type="button" variant="outline" disabled={disabled} aria-label="识别语言" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{languages.find(l => l.id === value).label}<ChevronDown/></Button>}/></div>;
}
function Composer({ busy, running, language, setLanguage, onStart, onError }) {
  const [file, setFile] = useState(null), [dragging, setDragging] = useState(false);
  const input = useRef(null);
  function choose(value) {
    if (value && value.size > 512 * 1024 ** 2) { onError('视频不能超过 512 MB'); input.current.value = ''; setFile(null); return; }
    setFile(value || null); onError('');
  }
  return <div className="yd-composer-wrap yd-rise"><form className="yd-composer" onSubmit={e => { e.preventDefault(); if (file) onStart(file); }}><div className="yd-composer-inner">
    <div className={`yd-drop ${dragging ? 'dragging' : ''}`} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDrop={() => setDragging(false)}>
      <input ref={input} type="file" accept="video/*" aria-label="导入视频文件" disabled={busy} onChange={e => { setDragging(false); choose(e.target.files[0]); }}/>
      {file ? <><span className="yd-file-icon"><FileTypeIcon path={file.name}/></span><div className="yd-file-description"><strong>{file.name}</strong><small>{fileSizeText(file.size)} · 点击或拖入以替换</small></div><IconButton type="button" className="yd-icon-button yd-remove" label="移除视频" disabled={busy} onClick={() => { choose(null); input.current.value = ''; }}><X/></IconButton></> : <div className="yd-drop-empty"><span className="yd-upload-icon"><Upload/></span><p>拖入视频，或点击选择文件</p><small>视频 · 最大 512 MB</small></div>}
    </div>
    <div className="yd-composer-actions"><Language value={language} onChange={setLanguage} disabled={busy}/><Button variant="primary" type="submit" disabled={!file || busy || running} icon={<ArrowRight/>}>{busy ? '正在导入…' : '开始处理'}</Button></div>
  </div></form></div>;
}
function TaskCards({ tasks, onOpen }) {
  return tasks.length ? <div className="yd-task-cards">{tasks.map(task => <Button className="yd-task-card" variant="outline" key={task.id} onClick={() => onOpen(task.id)}>
    <div className="yd-cover"><video src={`/api/youdub/video?id=${task.id}#t=0.1`} muted preload="metadata" aria-hidden="true"/></div>
    <div className="yd-task-card-content"><strong>{task.sourceName}</strong><div><Status status={task.status}/><time>{new Date(task.createdAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div></div>
  </Button>)}</div> : <div className="yd-no-tasks"><BrandMark className="yd-empty-logo"/><p>还没有字幕任务</p></div>;
}
function Sidebar({ collapsed, useStore, actions, toggleSidebar, beginNavigation, themeSource, changeTheme }) {
  const page = useStore(s => s.page), disabled = useStore(blocked);
  const theme = useSyncExternalStore(themeSource.subscribe, themeSource.getSnapshot);
  const dark = theme.active.colorScheme === 'dark';
  function navigate(page) { actions.navigate(page); beginNavigation(); }
  return <aside className="yd yd-sidebar" data-collapsed={collapsed || undefined}>
    <div className="yd-sidebar-chrome" data-window-drag><IconButton label={collapsed ? '展开侧边栏' : '收起侧边栏'} onClick={toggleSidebar}><PanelLeft/></IconButton></div>
    <div className="yd-brand-row"><Button className="yd-brand" aria-label="YouDub 首页" disabled={disabled} onClick={() => navigate('studio')}><BrandMark animated wordmark={!collapsed} className="yd-logo"/></Button></div>
    <Button variant="primary" className="yd-new" aria-label="新建任务" disabled={disabled} icon={<Plus/>} onClick={() => navigate('studio')}>{!collapsed && '新建任务'}</Button>
    <nav aria-label="主导航"><Button aria-label="工作台" aria-current={page === 'studio' ? 'page' : undefined} disabled={disabled} icon={<Sparkles/>} onClick={() => navigate('studio')}>{!collapsed && '工作台'}</Button><Button aria-label="任务记录" aria-current={page !== 'studio' ? 'page' : undefined} disabled={disabled} icon={<History/>} onClick={() => navigate('tasks')}>{!collapsed && '任务记录'}</Button></nav>
    <div className="yd-sidebar-bottom"><IconButton label={dark ? '切换到浅色' : '切换到深色'} onClick={() => changeTheme(dark ? 'light' : 'dark')}>{dark ? <Sun/> : <Moon/>}</IconButton></div>
  </aside>;
}
function Leading({ toggleSidebar }) { return <div className="yd"><IconButton label="展开侧边栏" onClick={toggleSidebar}><PanelLeft/></IconButton></div>; }
function Workbench({ useStore, actions }) {
  const state = useStore(s => s), { tasks, selected, page, draft, error, busy, loading } = state;
  const [language, setLanguage] = useState('auto'), [position, setPosition] = useState(0);
  const video = useRef(null), scroll = useRef(null);
  const task = selectedTask(state), dirty = isDirty(state);
  const running = tasks.some(t => t.status === 'recognizing');
  const canEdit = task && ['awaiting_review', 'confirmed', 'exported'].includes(task.status);
  async function load(discardDraft = false) { actions.loadTasks(await (await api('tasks')).json(), discardDraft); }
  useEffect(() => { load().catch(e => actions.fail(e.message)); }, []);
  useEffect(() => { scroll.current.scrollTop = 0; setPosition(0); }, [page, selected]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { load().catch(e => { clearInterval(timer); actions.fail(e.message); }); }, 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!dirty) return;
    const handler = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function action(fn) {
    actions.begin();
    try { await fn(); } catch (e) { actions.fail(e.message); } finally { actions.finish(); }
  }
  function openTask(id) { actions.navigate('task', id); }
  async function start(file) {
    await action(async () => {
      const value = await (await api(`import?name=${encodeURIComponent(file.name)}`, {method:'POST', body:file})).json();
      actions.imported(value);
      await post('recognize', {id:value.id, revision:value.revision, language}); await load();
    });
  }
  async function command(name, extra = {}) { await action(async () => { await post(name, {id:task.id, revision:task.revision, ...extra}); await load(name === 'edit'); }); }
  async function download() {
    await action(async () => {
      await post('export', {id:task.id, revision:task.revision});
      const a = document.createElement('a');
      a.href = `/api/youdub/download?id=${task.id}`; a.download = `${task.sourceName.replace(/\.[^.]+$/, '')}.srt`;
      document.body.append(a); a.click(); a.remove(); await load();
    });
  }
  const stage = !task || task.status === 'imported' || task.status === 'recognizing' ? 1 : task.status === 'awaiting_review' ? 2 : ['confirmed','exporting','exported'].includes(task.status) ? 3 : 1;
  const pending = tasks.filter(t => t.status === 'awaiting_review');
  return <div className="yd yd-panel">
    {page === 'task' && task ? <header className="yd-header yd-task-header" data-window-drag><div><IconButton label="返回工作台" disabled={dirty || busy} onClick={() => actions.navigate('studio')}><ArrowLeft/></IconButton><h1>{task.sourceName}</h1></div><Status status={task.status}/></header> : <div className="yd-main-chrome" data-window-drag aria-hidden="true"/>}
    <main className="yd-main" ref={scroll}>
    {error && <div className="yd-error" role="alert">{error} <Button size="sm" onClick={() => action(() => load(true))}>{dirty ? '放弃修改并重新加载' : '重新加载'}</Button></div>}
    {page === 'studio' && <><section className="yd-hero"><div className="yd-aurora" aria-hidden="true"/><div className="yd-grid" aria-hidden="true"/><div className="yd-home-content"><header className="yd-hero-heading yd-rise"><BrandMark animated className="yd-hero-logo"/><h1>让视频说<span className="yd-gradient-text">另一种语言</span></h1><p>导入视频，识别并校对原语言字幕，导出 SRT。</p></header>
      <Composer busy={busy} running={running} language={language} setLanguage={setLanguage} onStart={start} onError={actions.setError}/>
      {!!pending.length && <Button className="yd-review-link" onClick={() => pending.length === 1 ? openTask(pending[0].id) : actions.navigate('tasks')}>{pending.length} 个任务待确认<ArrowRight/></Button>}
    </div></section><section className="yd-recent"><div className="yd-section-heading"><h2>最近任务</h2><Button size="sm" onClick={() => actions.navigate('tasks')}>查看全部<ArrowRight/></Button></div>{loading ? <p role="status">正在加载…</p> : <TaskCards tasks={tasks.slice(0,6)} onOpen={openTask}/>}</section></>}
    {page === 'tasks' && <section className="yd-recent"><div className="yd-section-heading"><h1>任务记录</h1><Button variant="primary" icon={<Plus/>} onClick={() => actions.navigate('studio')}>新建任务</Button></div><TaskCards tasks={tasks} onOpen={openTask}/></section>}
    {page === 'task' && task && <div className="yd-task-page">
      <ol className="yd-steps" aria-label="字幕工作流">{['导入视频','识别语音','校对确认','导出字幕'].map((label,index) => <li key={label} className={index <= stage ? 'current' : ''}><StateDot appearance="step" state={index < stage || task.status === 'exported' ? 'done' : index === stage ? task.status === 'failed' ? 'error' : task.status === 'recognizing' ? 'ongoing' : 'warning' : 'idle'}/>{label}</li>)}</ol>
      {task.error && <div className="yd-error" role="alert"><strong>{task.error.code}</strong><pre>{task.error.message}</pre></div>}
      <div className="yd-workspace"><section className="yd-preview"><div className="yd-section-title"><h2>视频预览</h2></div><video key={task.id} ref={video} src={`/api/youdub/video?id=${task.id}`} controls preload="metadata" onTimeUpdate={e => setPosition(e.currentTarget.currentTime * 1000)}/><div className="yd-caption">{task.transcript?.segments.find(s => s.start_ms <= position && s.end_ms > position)?.text || '　'}</div>
        {task.status === 'imported' && <div className="yd-recognize"><Language value={language} onChange={setLanguage}/><Button variant="primary" disabled={busy || running} onClick={() => command('recognize',{language})}>开始识别</Button></div>}
        {task.status === 'recognizing' && <div className="yd-progress" role="status"><progress {...(task.progress?.value == null ? {} : {value:task.progress.value,max:1})}/><span>{task.progress?.message || '正在准备识别'}</span></div>}
        {task.mediaInfo && <div className="yd-media-info"><span>{time(task.mediaInfo.duration_ms)}</span><span>{task.transcript?.detected_language?.toUpperCase()}</span><span>{task.transcript?.segments.length} 条字幕</span></div>}
      </section><section className="yd-editor"><div className="yd-section-title"><h2>字幕校对</h2><span>{dirty ? '有未保存修改' : task.status === 'awaiting_review' ? '等待确认' : ''}</span></div>
        {task.transcript ? <><div className="yd-segments">{task.transcript.segments.map((segment,index) => <div className={`yd-segment ${segment.start_ms <= position && segment.end_ms > position ? 'playing' : ''}`} key={segment.id}>
          <Button className="yd-time" size="sm" aria-label={`播放第 ${index + 1} 条字幕`} onClick={() => { video.current.currentTime = segment.start_ms / 1000; video.current.play().catch(e => actions.setError(e.message)); }}><span>{String(index+1).padStart(2,'0')}</span>{time(segment.start_ms)} → {time(segment.end_ms)}</Button>
          <textarea aria-label={`第 ${index+1} 条字幕`} rows={2} value={draft[index]?.text ?? segment.text} disabled={!canEdit || busy} onChange={e => actions.editSegment(index,e.target.value)}/>
        </div>)}</div><footer className="yd-actions"><Button variant="outline" disabled={!dirty || busy || !canEdit} onClick={() => command('edit',{segments:draft})}>保存修改</Button>
          {task.status === 'awaiting_review' && <Button variant="primary" disabled={dirty || busy} icon={<Check/>} onClick={() => command('confirm')}>确认字幕</Button>}
          {['confirmed','exported'].includes(task.status) && <Button variant="primary" disabled={dirty || busy} onClick={download}>{busy ? '正在导出…' : '导出 SRT'}</Button>}
        </footer></> : <div className="yd-editor-empty">{task.status === 'recognizing' ? '正在识别，完成后可校对字幕' : '识别完成后显示字幕'}</div>}
      </section></div>
    </div>}
  </main></div>;
}
export function apply(ctx) {
  const store = defineStore({
    init: () => ({ tasks:[], selected:null, page:'studio', draft:[], error:'', busy:false, loading:true }),
    actions: {
      loadTasks(d, tasks, discardDraft = false) {
        const before = selectedTask(d), after = tasks.find(t => t.id === d.selected);
        const changed = before?.id !== after?.id || before?.revision !== after?.revision;
        if (!discardDraft && isDirty(d) && changed) {
          d.error = '任务已在其他窗口更新，当前未保存的修改已保留。';
          d.tasks = tasks.map(t => t.id === d.selected ? before : t);
        } else {
          d.tasks = tasks;
          if (changed || discardDraft) d.draft = draftFor(after);
        }
        d.loading = false;
      },
      navigate(d, page, id = null) { if (blocked(d)) return; d.page = page; d.selected = id; d.error = ''; d.draft = draftFor(selectedTask(d)); },
      imported(d, task) { d.tasks.unshift(task); d.selected = task.id; d.page = 'task'; d.draft = []; },
      editSegment(d, index, text) { d.draft[index].text = text; },
      begin(d) { d.error = ''; d.busy = true; }, finish(d) { d.busy = false; },
      setError(d, message) { d.error = message; }, fail(d, message) { d.error = message; d.loading = false; },
    },
  });
  const themeSource = { getSnapshot:() => ctx.theme.getTheme(), subscribe:listener => ctx.on('theme/change', listener) };
  ctx.effect(() => ctx.theme.overrideTokens('@youdub/harness-subtitles', tokens));
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.pluginCss = '@youdub/harness-subtitles'; style.textContent = themeCss + css; document.head.append(style); return () => style.remove(); });
  const inject = () => ({ toggleSidebar:() => ctx.layout.toggleSidebar(), beginNavigation:() => ctx.layout.beginNavigation(), themeSource, changeTheme:value => ctx.theme.setTheme(value) });
  ctx.slots.inject('sidebar', () => ctx.slots.register({name:'sidebar', store, inject}, Sidebar));
  ctx.slots.inject('shell.leading', () => ctx.slots.register({name:'shell.leading', inject}, Leading));
  ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({name:'main', key:'youdub', store}, Workbench);
    ctx.layout.selectPanel('youdub');
    return dispose;
  });
}
