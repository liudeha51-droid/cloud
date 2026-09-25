// CloudVault lightweight Windows launcher (no Rust/Node needed to build — see build.ps1).
// The app's files are embedded in the .exe. It serves them on http://localhost:47821 and
// opens a chromeless Microsoft Edge app window with its own private profile.
// The full native build (Tauri) is produced by the GitHub "Release desktop" workflow.
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
    const int Port = 47821;
    static readonly string Url = "http://localhost:" + Port + "/";

    [STAThread]
    static void Main()
    {
        HttpListener listener = new HttpListener();
        listener.Prefixes.Add(Url);
        bool serving = true;
        try { listener.Start(); }
        catch (HttpListenerException) { serving = false; } // another CloudVault window is already serving

        if (serving)
        {
            Thread t = new Thread(() => Serve(listener));
            t.IsBackground = true;
            t.Start();
        }

        string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CloudVault");
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
            Process.Start(Url); // fall back to the default browser
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
