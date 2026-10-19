using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new DesktopWindow(args)) Application.Run(window);
        return Environment.ExitCode;
    }
}

internal sealed class DesktopWindow : Form
{
    private readonly WebView2 browser = new WebView2();
    private readonly Label status = new Label();
    private readonly string data;
    private readonly string report;
    private readonly bool hold;
    private readonly object logLock = new object();
    private readonly TaskCompletionSource<string> ready = new TaskCompletionSource<string>();
    private FileStream instanceLock;
    private StreamWriter log;
    private Process server;
    private ProcessJob job;
    private Uri origin;
    private bool closing, closed;

    public DesktopWindow(string[] args)
    {
        data = Path.GetFullPath(Environment.GetEnvironmentVariable("YOUDUB_DESKTOP_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YouDub"));
        if (args.Length == 2 && (args[0] == "--smoke-test" || args[0] == "--smoke-hold"))
        {
            report = Path.GetFullPath(args[1]);
            hold = args[0] == "--smoke-hold";
            ShowInTaskbar = false;
            Opacity = 0;
        }
        Text = "YouDub";
        var workArea = Screen.FromPoint(Cursor.Position).WorkingArea;
        var width = Math.Min(workArea.Width, Math.Max(1280, (int)(workArea.Width * 0.9)));
        var height = Math.Min(workArea.Height, Math.Max(850, (int)(workArea.Height * 0.9)));
        MinimumSize = new Size(Math.Min(960, workArea.Width), Math.Min(640, workArea.Height));
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(workArea.Left + (workArea.Width - width) / 2,
                               workArea.Top + (workArea.Height - height) / 2, width, height);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        browser.Dock = DockStyle.Fill;
        status.Text = "正在启动 YouDub…";
        status.Dock = DockStyle.Fill;
        status.TextAlign = ContentAlignment.MiddleCenter;
        var menu = new MenuStrip();
        menu.Items.Add("刷新", null, delegate { if (origin != null) browser.Reload(); });
        menu.Items.Add("查看日志", null, delegate { OpenExternal(Path.Combine(data, "logs", "desktop.log")); });
        menu.Items.Add("退出", null, delegate { Close(); });
        Controls.Add(browser);
        Controls.Add(status);
        Controls.Add(menu);
        MainMenuStrip = menu;
        KeyPreview = true;
        KeyDown += delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.F5 || (e.Control && e.KeyCode == Keys.R)) { if (origin != null) browser.Reload(); e.Handled = true; } };
        Shown += async delegate { await StartAsync(); };
        FormClosing += async delegate(object sender, FormClosingEventArgs e)
        {
            if (closed) return;
            e.Cancel = true;
            if (closing) return;
            closing = true;
            status.Text = "正在停止本地服务…";
            status.Visible = true;
            await StopAsync();
            closed = true;
            Close();
        };
    }

    private void Log(string line)
    {
        lock (logLock) { if (log != null) { log.WriteLine(line); log.Flush(); } }
    }

    private void OpenExternal(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
        catch (Exception error) { Log(error.ToString()); if (report == null) MessageBox.Show(this, error.Message, "无法打开", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private bool Local(string address)
    {
        Uri uri;
        return Uri.TryCreate(address, UriKind.Absolute, out uri) && origin != null && uri.GetLeftPart(UriPartial.Authority) == origin.GetLeftPart(UriPartial.Authority);
    }

    private void ExternalLink(string address)
    {
        Uri uri;
        if (Uri.TryCreate(address, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http" || uri.Scheme == "mailto")) OpenExternal(address);
    }

    private async Task StartAsync()
    {
        try
        {
            Directory.CreateDirectory(data);
            try { instanceLock = new FileStream(Path.Combine(data, "desktop.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) { throw new InvalidOperationException("此数据目录已有 YouDub 桌面实例运行。"); }
            Directory.CreateDirectory(Path.Combine(data, "logs"));
            log = new StreamWriter(new FileStream(Path.Combine(data, "logs", "desktop.log"), FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false));
            Log("--- YouDub " + DateTimeOffset.Now.ToString("o") + " ---");
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "webview2"));
            if (closing) return;
            await browser.EnsureCoreWebView2Async(environment);
            if (closing) return;
            browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            browser.CoreWebView2.Settings.IsWebMessageEnabled = false;
            browser.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
            {
                if (Local(e.Uri) || e.Uri == "about:blank" || e.Uri.StartsWith("blob:")) return;
                e.Cancel = true;
                ExternalLink(e.Uri);
            };
            browser.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
            {
                e.Handled = true;
                if (Local(e.Uri)) browser.CoreWebView2.Navigate(e.Uri); else ExternalLink(e.Uri);
            };
            browser.CoreWebView2.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e)
            {
                if (!closing) Fail(new Exception("界面进程已退出：" + e.ProcessFailedKind));
            };
            var resources = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "resources");
            var start = new ProcessStartInfo(Path.Combine(resources, "node.exe"), "--expose-internals --import tsx apps/desktop/windows/bootstrap.mjs")
            {
                WorkingDirectory = Path.Combine(resources, "runtime"), UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            start.EnvironmentVariables["YOUDUB_DESKTOP_DATA_DIR"] = data;
            start.EnvironmentVariables["NODE_ENV"] = "production";
            start.EnvironmentVariables["NEXT_TELEMETRY_DISABLED"] = "1";
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            // Some GUI launch environments omit System32 (tar, where, etc.).
            start.EnvironmentVariables["PATH"] = resources + ";" + Environment.SystemDirectory + ";" + start.EnvironmentVariables["PATH"];
            job = new ProcessJob();
            server = new Process { StartInfo = start, EnableRaisingEvents = true };
            server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                Log(e.Data);
                if (e.Data.StartsWith("YOUDUB_READY=")) ready.TrySetResult(e.Data.Substring("YOUDUB_READY=".Length));
            };
            server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
            server.Exited += delegate
            {
                if (closing) return;
                var error = new Exception("本地服务已退出（" + server.ExitCode + "）。请查看日志后重新启动。");
                ready.TrySetException(error);
                if (origin != null && !IsDisposed) BeginInvoke(new Action(delegate { Fail(error); }));
            };
            server.Start();
            job.Add(server);
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            server.StandardInput.WriteLine("start");
            server.StandardInput.Flush();
            if (await Task.WhenAny(ready.Task, Task.Delay(90000)) != ready.Task) throw new TimeoutException("本地服务启动超时，请查看日志。");
            string address = await ready.Task;
            if (closing) return;
            origin = new Uri(address);
            if (origin.Scheme != "http" || origin.Host != "127.0.0.1") throw new Exception("本地服务返回了无效地址。");
            await NavigateAsync(address);
            status.Visible = false;
            if (report != null) await SmokeAsync();
        }
        catch (WebView2RuntimeNotFoundException error)
        {
            if (report == null && MessageBox.Show(this, "需要 Microsoft Edge WebView2 Runtime。是否打开微软下载页面？", "YouDub", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
            Fail(error);
        }
        catch (Exception error) { if (!closing) Fail(error); }
    }

    private async Task NavigateAsync(string address)
    {
        var loaded = new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2NavigationCompletedEventArgs> handler = delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess) loaded.TrySetResult(true); else loaded.TrySetException(new Exception("页面加载失败：" + e.WebErrorStatus));
        };
        browser.CoreWebView2.NavigationCompleted += handler;
        try
        {
            browser.CoreWebView2.Navigate(address);
            if (await Task.WhenAny(loaded.Task, Task.Delay(30000)) != loaded.Task) throw new TimeoutException("页面加载超时。");
            await loaded.Task;
        }
        finally { browser.CoreWebView2.NavigationCompleted -= handler; }
    }

    private async Task SmokeAsync()
    {
        string[] routes = { "/", "/favicon.ico", "/icon.svg", "/tasks", "/settings", "/api/setup", "/plugin-platform/1/react.mjs", "/examples/index.html", "/examples/player.js", "/examples/demos.js" };
        using (var client = new HttpClient(new HttpClientHandler { UseProxy = false }))
        {
            client.Timeout = TimeSpan.FromSeconds(15);
            foreach (string path in routes)
            {
                using (var response = await client.GetAsync(new Uri(origin, path)))
                {
                    response.EnsureSuccessStatusCode();
                    await response.Content.ReadAsByteArrayAsync();
                }
            }
        }
        foreach (string path in new[] { "/", "/tasks", "/settings" })
        {
            await NavigateAsync(new Uri(origin, path).ToString());
            bool rendered = false;
            for (int attempt = 0; attempt < 100; attempt++)
            {
                if (await browser.ExecuteScriptAsync("!!document.querySelector('section[aria-label=\"环境准备\"]')") == "true") { rendered = true; break; }
                await Task.Delay(100);
            }
            if (!rendered) throw new Exception("首次准备界面未在 WebView2 渲染：" + path);
            string diagnostics = await browser.ExecuteScriptAsync(@"(() => {
                const log = document.querySelector('textarea[aria-label=""诊断日志内容""]');
                const feedback = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('反馈 Issue'));
                if (!log || !feedback || !log.value.includes('win32 x64') || !log.value.includes('YOUDUB_PYTHON')) return false;
                const url = new URL(feedback.href);
                return url.origin === 'https://github.com' && url.pathname === '/liuzhao1225/YouDub-webui/issues/new'
                    && url.searchParams.get('body').includes('win32 x64')
                    && url.searchParams.get('body').includes('粘贴从准备页复制的完整诊断日志')
                    && log.value.indexOf('错误日志:') > log.value.indexOf('模型准备:')
                    && Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('复制日志'));
            })()");
            if (diagnostics != "true") throw new Exception("准备日志或预填 Issue 入口未正确渲染：" + path);
        }
        await NavigateAsync(new Uri(origin, "/examples/index.html").ToString());
        bool exampleLoaded = false;
        for (int attempt = 0; attempt < 100; attempt++)
        {
            if (await browser.ExecuteScriptAsync("Array.from(document.querySelectorAll('video')).some(v => v.readyState >= 1 && v.videoWidth > 0)") == "true") { exampleLoaded = true; break; }
            await Task.Delay(100);
        }
        if (!exampleLoaded) throw new Exception("内置示例视频未在 WebView2 加载。");
        using (var png = File.Create(report + ".png")) await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, png);
        WriteReport(new { ok = true, url = origin.ToString(), serverPid = server.Id, browserPid = browser.CoreWebView2.BrowserProcessId, webview2 = browser.CoreWebView2.Environment.BrowserVersionString, routes = routes, rendered = new[] { "/", "/tasks", "/settings", "/examples/index.html" } });
        if (!hold) Close();
    }

    private void WriteReport(object value)
    {
        File.WriteAllText(report, new JavaScriptSerializer().Serialize(value), new UTF8Encoding(false));
    }

    private void Fail(Exception error)
    {
        if (closing) return;
        Environment.ExitCode = 1;
        Log(error.ToString());
        if (report != null) WriteReport(new { ok = false, error = error.ToString() });
        else MessageBox.Show(this, error.Message + "\n\n日志：" + Path.Combine(data, "logs", "desktop.log"), "YouDub 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }

    private async Task StopAsync()
    {
        try
        {
            if (server != null && !server.HasExited)
            {
                // Closing stdin lets Host dispose its plugins before terminating Node.
                server.StandardInput.Close();
                bool exited = await Task.Run(() => server.WaitForExit(30000));
                if (!exited) { Log("Shutdown timeout; terminating application process tree."); Environment.ExitCode = 1; }
                else if (server.ExitCode != 0) { Log("Server shutdown failed: " + server.ExitCode); Environment.ExitCode = 1; }
            }
        }
        catch (Exception error) { Log(error.ToString()); Environment.ExitCode = 1; }
        finally
        {
            if (job != null) { job.Dispose(); job = null; }
            browser.Dispose();
            if (server != null) { server.Dispose(); server = null; }
            lock (logLock) { if (log != null) { log.Dispose(); log = null; } }
            if (instanceLock != null) { instanceLock.Dispose(); instanceLock = null; }
        }
    }
}

// Keep all Node/Python/FFmpeg descendants tied to the launcher, including on crash.
internal sealed class ProcessJob : IDisposable
{
    private IntPtr handle;
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    public ProcessJob()
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        var limits = new ExtendedLimits();
        limits.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(limits))) { Dispose(); throw new System.ComponentModel.Win32Exception(); }
    }
    public void Add(Process process)
    {
        if (!AssignProcessToJobObject(handle, process.Handle)) { process.Kill(); throw new System.ComponentModel.Win32Exception(); }
    }
    public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
}
