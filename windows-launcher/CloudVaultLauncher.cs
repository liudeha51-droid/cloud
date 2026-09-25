// CloudVault lightweight Windows launcher (no Rust/Node needed to build — see build.ps1).
// The app's files are embedded in the .exe. It serves them on http://localhost:47821 and
// opens a chromeless Microsoft Edge app window with its own private profile.
// The full native build (Tauri) is produced by the GitHub "Release" workflow.
// CloudVault 轻量级 Windows 启动器（编译无需 Rust/Node —— 见 build.ps1）。
// 应用文件全部嵌入在 .exe 中，通过 http://localhost:47821 提供，
// 并打开一个无地址栏的 Microsoft Edge 应用窗口（使用独立的私有配置文件）。
// 完整的原生版本（Tauri）由 GitHub 的 "Release" 工作流构建。
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("CloudVault")]
[assembly: AssemblyProduct("CloudVault")]
[assembly: AssemblyVersion("0.1.0.0")]

static class CloudVaultLauncher
{
    // Fixed port: the vault's local encrypted copy is stored per-origin, so it must not change.
    // 固定端口：密码库的本地加密副本按来源（origin）存储，所以端口不能变。
    const int Port = 47821;
    static readonly string Url = "http://localhost:" + Port + "/";

    [STAThread]
    static void Main()
    {
        HttpListener listener = new HttpListener();
        listener.Prefixes.Add(Url);
        bool serving = true;
        try { listener.Start(); }
        catch (HttpListenerException) { serving = false; } // another CloudVault window is already serving / 已有另一个 CloudVault 窗口在提供服务

        if (serving)
        {
            Thread t = new Thread(() => Serve(listener));
            t.IsBackground = true;
            t.Start();
        }

        // Portable mode: with portable.txt next to the .exe, keep the browser profile beside it.
        // 便携模式：.exe 旁边有 portable.txt 时，把浏览器配置文件保存在它旁边。
        string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string dataDir = File.Exists(Path.Combine(exeDir, "portable.txt"))
            ? Path.Combine(exeDir, "CloudVault-data")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CloudVault");
        string edge = FindEdge();
        Process p = null;
        if (edge != null)
        {
            p = Process.Start(new ProcessStartInfo(edge,
                "--app=" + Url + " --user-data-dir=\"" + Path.Combine(dataDir, "EdgeProfile") + "\"" +
                " --no-first-run --no-default-browser-check --window-size=1100,760") { UseShellExecute = false });
        }
        else
        {
            Process.Start(Url); // fall back to the default browser / 找不到 Edge 时改用默认浏览器
        }

        if (!serving) return;
        if (p != null) p.WaitForExit();
        else MessageBox.Show("CloudVault is running in your browser.\nClose this box to stop it.", "CloudVault");
        listener.Stop();
    }

    static string FindEdge()
    {
        string[] candidates = {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) + @"\Microsoft\Edge\Application\msedge.exe",
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) + @"\Microsoft\Edge\Application\msedge.exe",
        };
        foreach (string c in candidates) if (File.Exists(c)) return c;
        return null;
    }

    static string Mime(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".webmanifest": return "application/manifest+json";
            default: return "application/octet-stream";
        }
    }

    static void Serve(HttpListener listener)
    {
        Assembly asm = Assembly.GetExecutingAssembly();
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); } catch { return; }
            try
            {
                string path = ctx.Request.Url.AbsolutePath;
                if (path.EndsWith("/")) path += "index.html";
                // Resources are embedded as "app/<relative path>"; no file system access at all.
                // 资源以 "app/<相对路径>" 的名称嵌入；完全不访问文件系统。
                using (Stream s = asm.GetManifestResourceStream("app" + path))
                {
                    if (s == null || ctx.Request.HttpMethod != "GET") { ctx.Response.StatusCode = 404; }
                    else
                    {
                        ctx.Response.ContentType = Mime(path);
                        ctx.Response.Headers["Cache-Control"] = "no-cache";
                        ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
                        ctx.Response.Headers["X-Frame-Options"] = "DENY";
                        ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
                        s.CopyTo(ctx.Response.OutputStream);
                    }
                }
            }
            catch { ctx.Response.StatusCode = 500; }
            finally { try { ctx.Response.Close(); } catch { } }
        }
    }
}
