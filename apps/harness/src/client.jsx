import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Film, History, Moon, PanelLeftClose, PanelLeftOpen, Plus, Sparkles, Sun, Upload, X } from 'lucide-react';
import { BrandMark } from '@/components/brand/brand-mark';
import themeCss from 'youdub:theme';
import css from './style.css';
export const inject = ['slots'];
const labels = { imported: '待识别', recognizing: '正在识别', awaiting_review: '待人工确认', confirmed: '已确认', exporting: '正在导出', exported: '已导出', failed: '执行失败' };
const time = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${(ms / 1000 % 60).toFixed(2).padStart(5, '0')}`;
async function api(path, options) {
  const response = await fetch(`/api/youdub/${path}`, options);
  if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || `请求失败 (${response.status})`); }
  return response;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function Language({ value, onChange, disabled }) {
  return <label className="yd-language">识别语言<select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="auto">自动检测</option><option value="en">英语</option><option value="zh">中文</option><option value="ja">日语</option></select></label>;
}
function Composer({ busy, running, language, setLanguage, onStart, onError }) {
  const [file, setFile] = useState(null), [dragging, setDragging] = useState(false);
  const input = useRef(null);
  function choose(value) {
    if (value && value.size > 512 * 1024 ** 2) { onError('视频不能超过 512 MB'); input.current.value = ''; setFile(null); return; }
    setFile(value || null); onError('');
  }
  return <div className="yd-composer-wrap yd-rise">
    <form className="yd-composer" onSubmit={e => { e.preventDefault(); if (file) onStart(file); }}><div className="yd-composer-inner">
      <div className={`yd-drop ${dragging ? 'dragging' : ''} ${file ? 'chosen' : ''}`} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDrop={() => setDragging(false)}>
        <input ref={input} type="file" accept="video/*" aria-label="导入视频文件" disabled={busy} onChange={e => { setDragging(false); choose(e.target.files[0]); }}/>
        {file ? <><span className="yd-file-icon"><Film/></span><div className="yd-file-description"><strong>{file.name}</strong><small>{(file.size / 1024 ** 2).toFixed(1)} MB · 点击或拖入以替换</small></div><button type="button" className="yd-icon-button yd-remove" aria-label="移除视频" disabled={busy} onClick={() => { choose(null); input.current.value = ''; }}><X/></button></> : <div className="yd-drop-empty"><span className="yd-upload-icon"><Upload/></span><p>拖入视频，或点击选择文件</p><small>视频 · 最大 512 MB</small></div>}
      </div>
      <div className="yd-composer-actions"><Language value={language} onChange={setLanguage} disabled={busy}/><button className="yd-primary" type="submit" disabled={!file || busy || running}><ArrowRight/>{busy ? '正在导入…' : '开始处理'}</button></div>
    </div></form>
  </div>;
}
function TaskCards({ tasks, onOpen }) {
  return tasks.length ? <div className="yd-task-cards">{tasks.map(task => <button className="yd-task-card" key={task.id} onClick={() => onOpen(task.id)}>
    <div className="yd-cover"><video src={`/api/youdub/video?id=${task.id}#t=0.1`} muted preload="metadata" aria-hidden="true"/></div>
    <div className="yd-task-card-content"><strong>{task.sourceName}</strong><div><span className={`yd-badge ${task.status}`}>{labels[task.status]}</span><time>{new Date(task.createdAt).toLocaleString('zh-CN', { month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' })}</time></div></div>
  </button>)}</div> : <div className="yd-no-tasks"><BrandMark className="yd-empty-logo"/><p>还没有字幕任务</p></div>;
}
function Workbench() {
  const [tasks, setTasks] = useState([]), [selected, setSelected] = useState(null), [page, setPage] = useState('studio'), [draft, setDraft] = useState([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [language, setLanguage] = useState('auto');
  const [loading, setLoading] = useState(true), [position, setPosition] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('youdub-theme') === 'light' ? 'light' : 'dark');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('youdub-sidebar') === 'collapsed');
  const video = useRef(null);
  const task = tasks.find(t => t.id === selected);
  const dirty = Boolean(task?.transcript && draft.some((s, i) => s.text !== task.transcript.segments[i]?.text));
  const running = tasks.some(t => t.status === 'recognizing');
  const canEdit = task && ['awaiting_review', 'confirmed', 'exported'].includes(task.status);
  async function load() { setTasks(await (await api('tasks')).json()); setLoading(false); }
  useEffect(() => { load().catch(e => { setError(e.message); setLoading(false); }); }, []);
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(() => {
      if (stopped) return;
      load().catch(e => { stopped = true; clearInterval(timer); setError(e.message); });
    }, 1000);
    return () => { stopped = true; clearInterval(timer); };
  }, [running]);
  useEffect(() => { setDraft(task?.transcript?.segments.map(s => ({ id: s.id, text: s.text })) || []); }, [task?.id, task?.revision]);
  useEffect(() => {
    if (!dirty) return;
    const handler = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function action(fn) {
    setError(''); setBusy(true);
    try { await fn(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function navigate(next, id = null) { if (dirty || busy) return; setPage(next); setSelected(id); setError(''); setPosition(0); }
  function openTask(id) { navigate('task', id); }
  async function start(file) {
    await action(async () => {
      const value = await (await api(`import?name=${encodeURIComponent(file.name)}`, { method:'POST', body:file })).json();
      setTasks(current => [value, ...current]); setSelected(value.id); setPage('task');
      await post('recognize', { id:value.id, revision:value.revision, language }); await load();
    });
  }
  async function command(name, extra = {}) { await action(async () => { await post(name, { id:task.id, revision:task.revision, ...extra }); await load(); }); }
  async function download() {
    await action(async () => {
      const response = await post('export', { id:task.id, revision:task.revision });
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
      a.href = url; a.download = `${task.sourceName.replace(/\.[^.]+$/, '')}.srt`; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); await load();
    });
  }
  function changeTheme() { action(async () => { const next = theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('youdub-theme', next); setTheme(next); }); }
  function changeSidebar() { action(async () => { localStorage.setItem('youdub-sidebar', collapsed ? 'expanded' : 'collapsed'); setCollapsed(!collapsed); }); }
  const stage = !task || task.status === 'imported' || task.status === 'recognizing' ? 1 : task.status === 'awaiting_review' ? 2 : ['confirmed','exporting','exported'].includes(task.status) ? 3 : 1;
  const pending = tasks.filter(t => t.status === 'awaiting_review');
  const nav = <><button aria-label="工作台" aria-current={page === 'studio' ? 'page' : undefined} disabled={dirty || busy} onClick={() => navigate('studio')}><Sparkles/><span>工作台</span></button><button aria-label="任务记录" aria-current={page !== 'studio' ? 'page' : undefined} disabled={dirty || busy} onClick={() => navigate('tasks')}><History/><span>任务记录</span></button></>;
  const toggle = <button className="yd-icon-button" aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'} onClick={changeTheme}>{theme === 'dark' ? <Sun/> : <Moon/>}</button>;
  return <div className={`yd ${theme} ${collapsed ? 'yd-collapsed' : ''}`}>
    <aside className="yd-sidebar"><div className="yd-brand-row"><button className="yd-brand" aria-label="YouDub 首页" disabled={dirty || busy} onClick={() => navigate('studio')}><BrandMark animated wordmark={!collapsed} className="yd-logo"/></button>{!collapsed && <button className="yd-icon-button" aria-label="收起侧边栏" onClick={changeSidebar}><PanelLeftClose/></button>}</div>
      {collapsed && <button className="yd-icon-button yd-expand" aria-label="展开侧边栏" onClick={changeSidebar}><PanelLeftOpen/></button>}
      <button className="yd-primary yd-new" aria-label="新建任务" disabled={dirty || busy} onClick={() => navigate('studio')}><Plus/><span>新建任务</span></button>
      <nav aria-label="主导航">{nav}</nav><div className="yd-sidebar-bottom"><span>中文</span>{toggle}</div>
    </aside>
    <div className="yd-mobile-header"><button className="yd-brand" aria-label="YouDub 首页" disabled={dirty || busy} onClick={() => navigate('studio')}><BrandMark animated wordmark className="yd-logo"/></button>{toggle}</div>
    <main className="yd-main">
      {error && <div className="yd-error" role="alert">{error} <button onClick={() => action(load)}>重新加载</button></div>}
      {page === 'studio' && <>
        <section className="yd-hero"><div className="yd-aurora" aria-hidden="true"/><div className="yd-grid" aria-hidden="true"/><div className="yd-home-content"><header className="yd-hero-heading yd-rise"><BrandMark animated className="yd-hero-logo"/><h1>让视频说<span className="yd-gradient-text">另一种语言</span></h1><p>导入视频，识别并校对原语言字幕，导出 SRT。</p></header>
          <Composer busy={busy} running={running} language={language} setLanguage={setLanguage} onStart={start} onError={setError}/>
          {!!pending.length && <button className="yd-review-link" onClick={() => pending.length === 1 ? openTask(pending[0].id) : navigate('tasks')}>{pending.length} 个任务待确认<ArrowRight/></button>}
        </div></section>
        <section className="yd-recent"><div className="yd-section-heading"><h2>最近任务</h2><button onClick={() => navigate('tasks')}>查看全部<ArrowRight/></button></div>{loading ? <p role="status">正在加载…</p> : <TaskCards tasks={tasks.slice(0,6)} onOpen={openTask}/>}</section>
      </>}
      {page === 'tasks' && <section className="yd-recent"><div className="yd-section-heading"><h1>任务记录</h1><button className="yd-primary" onClick={() => navigate('studio')}><Plus/>新建任务</button></div><TaskCards tasks={tasks} onOpen={openTask}/></section>}
      {page === 'task' && task && <div className="yd-task-page">
        <header className="yd-header"><div><button className="yd-icon-button" aria-label="返回工作台" disabled={dirty || busy} onClick={() => navigate('studio')}><ArrowLeft/></button><h1>{task.sourceName}</h1></div><span className={`yd-badge ${task.status}`}>{labels[task.status]}</span></header>
        <ol className="yd-steps" aria-label="字幕工作流">{['导入视频','识别语音','校对确认','导出字幕'].map((label,index) => <li key={label} className={index <= stage ? 'current' : ''}><span>{index < stage ? <Check/> : index + 1}</span>{label}</li>)}</ol>
        {task.error && <div className="yd-error" role="alert"><strong>{task.error.code}</strong><pre>{task.error.message}</pre></div>}
        <div className="yd-workspace"><section className="yd-preview"><div className="yd-section-title"><h2>视频预览</h2></div>
          <video key={task.id} ref={video} src={`/api/youdub/video?id=${task.id}`} controls preload="metadata" onTimeUpdate={e => setPosition(e.currentTarget.currentTime * 1000)}/>
          <div className="yd-caption">{task.transcript?.segments.find(s => s.start_ms <= position && s.end_ms > position)?.text || '　'}</div>
          {task.status === 'imported' && <div className="yd-recognize"><Language value={language} onChange={setLanguage}/><button className="yd-primary" disabled={busy || running} onClick={() => command('recognize',{language})}>开始识别</button></div>}
          {task.status === 'recognizing' && <div className="yd-progress" role="status"><progress {...(task.progress?.value == null ? {} : {value:task.progress.value,max:1})}/><span>{task.progress?.message || '正在准备识别'}</span></div>}
          {task.mediaInfo && <div className="yd-media-info"><span>{time(task.mediaInfo.duration_ms)}</span><span>{task.transcript?.detected_language?.toUpperCase()}</span><span>{task.transcript?.segments.length} 条字幕</span></div>}
        </section><section className="yd-editor"><div className="yd-section-title"><h2>字幕校对</h2><span>{dirty ? '有未保存修改' : task.status === 'awaiting_review' ? '等待确认' : ''}</span></div>
          {task.transcript ? <><div className="yd-segments">{task.transcript.segments.map((segment,index) => <div className={`yd-segment ${segment.start_ms <= position && segment.end_ms > position ? 'playing' : ''}`} key={segment.id}>
            <button className="yd-time" aria-label={`播放第 ${index + 1} 条字幕`} onClick={() => { video.current.currentTime = segment.start_ms / 1000; video.current.play().catch(e => setError(e.message)); }}><span>{String(index+1).padStart(2,'0')}</span>{time(segment.start_ms)} → {time(segment.end_ms)}</button>
            <textarea aria-label={`第 ${index+1} 条字幕`} rows={2} value={draft[index]?.text ?? segment.text} disabled={!canEdit || busy} onChange={e => setDraft(current => current.map((s,i) => i === index ? {...s,text:e.target.value} : s))}/>
          </div>)}</div><footer className="yd-actions"><button disabled={!dirty || busy || !canEdit} onClick={() => command('edit',{segments:draft})}>保存修改</button>
            {task.status === 'awaiting_review' && <button className="yd-primary" disabled={dirty || busy} onClick={() => command('confirm')}><Check/>确认字幕</button>}
            {['confirmed','exported'].includes(task.status) && <button className="yd-primary" disabled={dirty || busy} onClick={download}>{busy ? '正在导出…' : '导出 SRT'}</button>}
          </footer></> : <div className="yd-editor-empty">{task.status === 'recognizing' ? '正在识别，完成后可校对字幕' : '识别完成后显示字幕'}</div>}
        </section></div>
      </div>}
    </main><nav className="yd-mobile-nav" aria-label="移动端主导航">{nav}</nav>
  </div>;
}
export function apply(ctx) {
  // rc.2 renders root through session-maybe, including sessionless products.
  const absent = { key:undefined,hooks:{},keyedHooks:{},props:{} };
  const source = { getSnapshot:() => absent,subscribe:() => () => {} };
  ctx.slots.installScope('session',{current:source,bindingSource:target => { if (target !== undefined) throw new Error('YouDub subtitles has no chat sessions'); return source; },renderArea:() => { throw new Error('YouDub subtitles has no session area'); }});
  const style = document.createElement('style'); style.textContent = themeCss + css; document.head.append(style);
  const title = document.title; document.title = 'YouDub';
  ctx.effect(() => () => { style.remove(); document.title = title; });
  ctx.slots.register({name:'root'},Workbench);
}
