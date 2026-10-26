/** Rebuild the reference from checked-in Harness CSS and the YouDub palette. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(resolve(root, path), 'utf8');
const upstream = 'vendor/deepseek-harness/source/packages/client/';
const primitives = ['Button','Input','InlineEditor','Switch','Checkbox','Tag','SegmentedControl','Menu','MenuSurface','Tooltip','Modal'];
const css = await Promise.all(primitives.map(async name => (await read(`${upstream}ui-primitives/src/${name}.module.css`)).replace(/\.([a-zA-Z_][\w-]*)/g, (_, cls) => `.${name}_${cls}`)));
const base = await read(`${upstream}ui-theme/src/styles/base.css`);
const corners = await read(`${upstream}ui-theme/src/styles/corner-shape.css`);
const elevation = await read(`${upstream}ui-theme/src/styles/gradient-shadow-text.css`);
const palette = await read(`${upstream}ui-theme/src/styles/design-platform.css`) + '\n' + await read('apps/web/src/app/harness-palette.css');
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const inline = s => escape(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>');
const source = await read('docs/design/harness-visual-spec.md');
let output='',table=false,list=false;const nav=[];
for(const line of source.split('\n')) {
 if(line.startsWith('|')) {
  if(/^\|\s*---/.test(line))continue;
  const tag=table?'td':'th';if(!table){output+='<div class="table-scroll"><table>';table=true;}
  output+='<tr>'+line.split('|').slice(1,-1).map(x=>`<${tag}>${inline(x.trim())}</${tag}>`).join('')+'</tr>';continue;
 }
 if(table){output+='</table></div>';table=false;}
 if(line.startsWith('- ')){if(!list){output+='<ul>';list=true;}output+='<li>'+inline(line.slice(2))+'</li>';continue;}
 if(list){output+='</ul>';list=false;}
 if(line.startsWith('## ')){const title=line.slice(3),id='section-'+nav.length;nav.push({title,id});output+=`<h2 id="${id}">${inline(title)}</h2>`;}
 else if(line.startsWith('# '))output+=`<h1>${inline(line.slice(2))}</h1>`;
 else if(line.trim())output+=`<p>${inline(line)}</p>`;
}
if(table)output+='</table></div>';if(list)output+='</ul>';
const gallery=`<section id="components" class="gallery"><h2>同源组件预览</h2><p class="muted">以下控件外观由 Harness 原始 CSS 生成，颜色直接读取 Harness 原生主题。用于查看尺寸、状态和配色。</p>
<div class="sample"><h3>操作</h3><div class="row"><button class="Button_button Button_md Button_primary">开始处理</button><button class="Button_button Button_md Button_outline">保存修改</button><button class="Button_button Button_md Button_ghost">取消</button><button disabled class="Button_button Button_md Button_primary">处理中</button><button class="Button_button Button_sm Button_outline">紧凑操作</button></div></div>
<div class="sample"><h3>输入与编辑</h3><div class="fields"><label>视频链接<span class="Input_wrap"><input class="Input_input" placeholder="粘贴视频链接"></span></label><label>禁用<span class="Input_wrap" style="opacity:.5"><input disabled class="Input_input" placeholder="当前不可修改"></span></label><label>字幕文本<textarea class="InlineEditor_editor" rows="3">让视频说另一种语言。</textarea></label><label>输入错误<span class="Input_wrap" style="border-color:var(--status-danger-fg)"><input class="Input_input" aria-invalid="true" value="示例内容"></span><small style="color:var(--status-danger-fg)">请检查输入内容</small></label></div></div>
<div class="sample"><h3>状态与选择</h3><div class="row">${[['neutral','等待中'],['info','提示'],['success','已完成'],['warning','待确认'],['danger','失败']].map(([tone,label])=>`<span class="Tag_tag" data-tone="${tone}">${label}</span>`).join('')}<button class="Switch_switch" role="switch" aria-checked="true" aria-label="自动继续"><span class="Switch_thumb"></span></button><label class="Checkbox_checkbox"><input type="checkbox" checked><span>自动继续</span></label></div></div>
<div class="sample"><h3>菜单与弹窗表面</h3><div class="row aligned"><div class="Menu_list MenuSurface_surface reference-menu"><span class="MenuSurface_material"></span><button class="Menu_item">浅色　✓</button><button class="Menu_item">深色</button><button class="Menu_item">跟随系统</button></div><div class="Modal_dialog reference-modal"><div class="Modal_header"><h3 class="Modal_title">保存修改</h3></div><p class="Modal_description">示例展示弹窗的圆角、字阶和留白。</p><div class="Modal_footer"><button class="Button_button Button_md Button_outline">取消</button><button class="Button_button Button_md Button_primary">保存修改</button></div></div></div></div></section>`;
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouDub · 视觉与组件规范</title><style>${base}\n${corners}\n${elevation}\n${palette}\n${css.join('\n')}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:14px/1.65 var(--dsw-font-family)}a{color:var(--link)}code{font:12px/1.6 var(--ds-font-family-code);overflow-wrap:anywhere}header{position:sticky;top:0;z-index:200;background:var(--surface);border-bottom:.5px solid var(--border);padding:16px 24px;display:flex;align-items:center;gap:16px}header strong{font-size:16px}header .row{margin-left:auto}.layout{display:grid;grid-template-columns:220px minmax(0,1fr);max-width:1400px;margin:auto;gap:40px;padding:32px 24px}nav{position:sticky;top:100px;align-self:start;display:grid;gap:8px;font-size:13px}nav a{text-decoration:none;color:var(--muted-foreground)}nav a:hover{color:var(--link)}h1{font-size:30px;line-height:1.3;margin:0 0 20px}h2{font-size:20px;font-weight:600;margin:40px 0 16px;scroll-margin-top:96px}h3{font-size:14px;font-weight:500;margin:0 0 12px}p{margin:12px 0}table{border-collapse:collapse;width:100%;font-size:13px;text-align:left}th,td{padding:12px;border-bottom:.5px solid var(--border);vertical-align:top}th{font-weight:500;background:var(--muted)}.table-scroll{overflow:auto;border:.5px solid var(--border);border-radius:var(--dsw-radius-lg);background:var(--card)}.muted,small{color:var(--muted-foreground)}.sample{padding:20px;margin:16px 0;border:.5px solid var(--border);border-radius:var(--dsw-radius-lg);background:var(--card)}.row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.aligned{align-items:flex-start;gap:24px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.fields label{display:flex;flex-direction:column;gap:6px}.fields .Input_wrap{width:100%}.fields textarea{width:100%}.reference-menu{position:relative;top:auto;left:auto;width:180px;z-index:1}.reference-modal{width:380px;max-width:100%}.brand{width:24px;height:24px;border-radius:var(--dsw-radius-sm);background:linear-gradient(135deg,var(--brand-pink),var(--brand-blue))}@media(max-width:800px){.layout{display:block;padding:24px 16px}nav{position:static;display:flex;flex-wrap:wrap;margin-bottom:32px}.fields{grid-template-columns:1fr}header{padding:12px 16px}h1{font-size:24px}}
</style></head><body><header><span class="brand" aria-hidden="true"></span><strong>YouDub 设计规范</strong><div class="row"><button data-theme="light" class="Button_button Button_sm Button_outline">浅色</button><button data-theme="dark" class="Button_button Button_sm Button_outline">深色</button></div></header><div class="layout"><nav><a href="#components">同源组件预览</a>${nav.map(n=>`<a href="#${n.id}">${escape(n.title)}</a>`).join('')}<a href="../docs/design/component-inventory.md">组件源码索引</a></nav><main>${gallery}${output}</main></div><script>document.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{document.documentElement.classList.toggle('dark',b.dataset.theme==='dark');document.body.toggleAttribute('data-ds-dark-theme',b.dataset.theme==='dark')});document.querySelector('[role=switch]').onclick=e=>{const b=e.currentTarget;b.setAttribute('aria-checked',String(b.getAttribute('aria-checked')!=='true'))};</script></body></html>`;
await mkdir(resolve(root, 'output'), { recursive: true });
await writeFile(resolve(root,'output/ui-design-reference.html'),html);
console.log('Built YouDub design reference from shared framework styles');
