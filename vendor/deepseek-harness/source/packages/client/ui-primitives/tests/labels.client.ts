import type { TerminalBlockLabels } from '../src/TerminalBlock.tsx'

export const terminalBlockLabels: TerminalBlockLabels = {
  commandLine: line => `命令第 ${line} 行`,
  exitCode: code => `退出码 ${code}`,
  noExitCode: '未正常退出',
  running: '运行中', failed: '失败', done: '已完成',
  copy: '复制', copied: '复制成功', noOutput: '无输出',
  collapseAria: '收起输出', collapse: '收起',
  expandAria: hidden => `展开其余 ${hidden} 行输出`,
  expand: hidden => `… 其余 ${hidden} 行`,
}
