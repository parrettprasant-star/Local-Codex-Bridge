using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Management;
using System.Runtime.InteropServices;

namespace LocalCodexBridgeDesktop
{
    internal static class Program
    {
#if BRIDGE_CODEX_PREVIEW
        private static bool IsPreviewBuild() { return true; }
#else
        private static bool IsPreviewBuild() { return false; }
#endif

        [STAThread]
        private static int Main(string[] args)
        {
            bool preview = IsPreviewBuild() || HasArg(args, "--preview");
            DesktopPaths.Configure(preview, ArgValue(args, "--test-state-root"));
            if (HasArg(args, "--signal-show")) return DesktopInstanceSignal.Signal(DesktopPaths.ShowEventName, DesktopPaths.ShowSignalFile) ? 0 : 3;
            if (HasArg(args, "--signal-exit")) return DesktopInstanceSignal.Signal(DesktopPaths.ExitEventName, DesktopPaths.ExitSignalFile) ? 0 : 3;
            if (HasArg(args, "--self-test")) return DesktopSelfTest.Run();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool created;
            using (Mutex mutex = new Mutex(true, DesktopPaths.MutexName, out created))
            {
                if (!created)
                {
                    if (DesktopInstanceSignal.Signal(DesktopPaths.ShowEventName)) return 0;
                    MessageBox.Show(DesktopPaths.ProductName + " 桌面应用已经在运行。请使用系统托盘或现有窗口。", DesktopPaths.ProductName, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 2;
                }
                using (EventWaitHandle showEvent = DesktopInstanceSignal.Create(DesktopPaths.ShowEventName))
                using (EventWaitHandle exitEvent = DesktopInstanceSignal.Create(DesktopPaths.ExitEventName))
                {
                    Application.Run(new DesktopApplicationContext(HasArg(args, "--debug"), HasArg(args, "--background"), HasArg(args, "--configure"), showEvent, exitEvent));
                }
            }
            return 0;
        }

        private static bool HasArg(string[] args, string expected)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], expected, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static string ArgValue(string[] args, string expected)
        {
            for (int i = 0; i + 1 < args.Length; i++)
            {
                if (string.Equals(args[i], expected, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
            }
            return "";
        }
    }

    internal static class DesktopSelfTest
    {
        internal static int Run()
        {
            string temporaryRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "LocalCodexBridge.Desktop.self-test." + Guid.NewGuid().ToString("N"));
            string selfTestStateRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "LocalCodexBridge.Desktop.self-test-state." + Guid.NewGuid().ToString("N"));
            bool originalPreview = DesktopPaths.IsPreview;
            try
            {
                DesktopPaths.Configure(true, selfTestStateRoot);
                if (!string.Equals(DesktopPaths.ProductName, "Local Codex Bridge", StringComparison.Ordinal)) return 7;
                int shortcutCode = ShortcutMigration.RunSelfTestCode();
                if (shortcutCode != 0) return shortcutCode;
                int configurationCode = V6TunnelProfile.RunConfigurationSelfTestCode();
                if (configurationCode != 0) return configurationCode;
                DesktopSettings settings = DesktopSettings.Default();
                if (string.IsNullOrEmpty(settings.StatusUrl)) return 3;
                new JavaScriptSerializer().Serialize(settings.ToDictionary());
                string portableDirectory = Path.Combine(temporaryRoot, "dist");
                Directory.CreateDirectory(portableDirectory);
                File.WriteAllText(Path.Combine(portableDirectory, "index.js"), "// portable layout self-test", Encoding.UTF8);
                string portableEntry = DesktopSettings.ResolveBridgeEntryPath(temporaryRoot, "dist\\src\\index.js");
                if (!string.Equals(Path.GetFullPath(portableEntry), Path.GetFullPath(Path.Combine(temporaryRoot, "dist", "index.js")), StringComparison.OrdinalIgnoreCase)) return 5;
                File.Delete(Path.Combine(portableDirectory, "index.js"));
                string sourceDirectory = Path.Combine(portableDirectory, "src");
                Directory.CreateDirectory(sourceDirectory);
                File.WriteAllText(Path.Combine(sourceDirectory, "index.js"), "// source layout self-test", Encoding.UTF8);
                string sourceEntry = DesktopSettings.ResolveBridgeEntryPath(temporaryRoot, "dist\\index.js");
                if (!string.Equals(Path.GetFullPath(sourceEntry), Path.GetFullPath(Path.Combine(temporaryRoot, "dist", "src", "index.js")), StringComparison.OrdinalIgnoreCase)) return 6;
                int layoutCode = DashboardForm.RunLayoutSelfTestCode();
                if (layoutCode != 0) return layoutCode;
                int resizeCode = DashboardForm.RunResizeSelfTestCode();
                if (resizeCode != 0) return resizeCode;
                int responsivenessCode = DashboardForm.RunResponsivenessSelfTestCode();
                if (responsivenessCode != 0) return responsivenessCode;
                int appHostCode = BridgeCodexHost.RunSelfTestCode();
                if (appHostCode != 0) return appHostCode;
                int appHostLifecycleCode = BridgeCodexWebViewForm.RunLifecycleSelfTestCode();
                if (appHostLifecycleCode != 0) return appHostLifecycleCode;
                int instanceSignalCode = DesktopInstanceSignal.RunSelfTestCode();
                if (instanceSignalCode != 0) return instanceSignalCode;
                int windowStateCode = WindowStateStore.RunSelfTestCode();
                if (windowStateCode != 0) return windowStateCode;
                int isolationCode = DesktopIsolationSelfTest.Run();
                if (isolationCode != 0) return isolationCode;
                return 0;
            }
            catch
            {
                return 4;
            }
            finally
            {
                try { DesktopPaths.Configure(originalPreview); } catch { }
                try { if (Directory.Exists(temporaryRoot)) Directory.Delete(temporaryRoot, true); } catch { }
                try { if (Directory.Exists(selfTestStateRoot)) Directory.Delete(selfTestStateRoot, true); } catch { }
            }
        }
    }

    internal static class DesktopPaths
    {
        internal static string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LocalCodexBridge");
        internal static string SettingsFile = Path.Combine(Root, "desktop-settings.json");
        internal static string RuntimeKeyFile = Path.Combine(Root, "runtime_key_v6.dpapi");
        internal static string LogDirectory = Path.Combine(Root, "logs");
        internal static string RunDirectory = Path.Combine(Root, "run");
        internal static string OwnershipFile = Path.Combine(RunDirectory, "desktop-ownership.json");
        internal static string HostStatusFile = Path.Combine(RunDirectory, "desktop-host-status.json");
        internal static string TunnelStateFile = Path.Combine(RunDirectory, "tunnel-state.json");
        internal static string TunnelProfileFile = Path.Combine(RunDirectory, "tunnel-profile.yaml");
        internal static string TunnelHealthUrlFile = Path.Combine(RunDirectory, "tunnel-health.url");
        internal static string StatusUrlFile = Path.Combine(RunDirectory, "status-url.json");
        internal static string WindowStateFile = Path.Combine(Root, "window-state.json");
        internal static string ShowSignalFile = Path.Combine(RunDirectory, "show.signal");
        internal static string ExitSignalFile = Path.Combine(RunDirectory, "exit.signal");
        internal static bool IsPreview { get; private set; }
        internal static bool IsTestStateRoot { get; private set; }
        internal static string ProductName { get { return "Local Codex Bridge"; } }
        internal static string MutexName { get { return IsPreview ? "Local\\BridgeCodex.V6Preview" : "Local\\LocalCodexBridge.Desktop"; } }
        internal static string ShowEventName { get { return IsPreview ? "Local\\BridgeCodex.V6Preview.Show" : "Local\\LocalCodexBridge.Desktop.Show"; } }
        internal static string ExitEventName { get { return IsPreview ? "Local\\BridgeCodex.V6Preview.Exit" : "Local\\LocalCodexBridge.Desktop.Exit"; } }

        internal static void Configure(bool preview)
        {
            Configure(preview, "");
        }

        internal static void Configure(bool preview, string testStateRoot)
        {
            IsPreview = preview;
            IsTestStateRoot = preview && !string.IsNullOrWhiteSpace(testStateRoot);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            Root = preview && !string.IsNullOrWhiteSpace(testStateRoot)
                ? Path.GetFullPath(testStateRoot)
                : (preview
                    ? Path.Combine(localAppData, "BridgeCodex", "V6Preview")
                    : Path.Combine(localAppData, "LocalCodexBridge"));
            SettingsFile = Path.Combine(Root, "desktop-settings.json");
            RuntimeKeyFile = Path.Combine(Root, "runtime_key_v6.dpapi");
            LogDirectory = Path.Combine(Root, "logs");
            RunDirectory = Path.Combine(Root, "run");
            OwnershipFile = Path.Combine(RunDirectory, "desktop-ownership.json");
            HostStatusFile = Path.Combine(RunDirectory, "desktop-host-status.json");
            TunnelStateFile = Path.Combine(RunDirectory, "tunnel-state.json");
            TunnelProfileFile = Path.Combine(RunDirectory, "tunnel-profile.yaml");
            TunnelHealthUrlFile = Path.Combine(RunDirectory, "tunnel-health.url");
            StatusUrlFile = Path.Combine(RunDirectory, "status-url.json");
            WindowStateFile = Path.Combine(Root, "window-state.json");
            ShowSignalFile = Path.Combine(RunDirectory, "show.signal");
            ExitSignalFile = Path.Combine(RunDirectory, "exit.signal");
        }

        internal static void EnsureDirectories()
        {
            Directory.CreateDirectory(Root);
            Directory.CreateDirectory(LogDirectory);
            Directory.CreateDirectory(RunDirectory);
        }
    }

    internal sealed class ShortcutSnapshot
    {
        internal string TargetPath;
        internal string Arguments;
    }

    internal static class ShortcutMigration
    {
        internal static bool EnsureCurrent(string shortcutPath, string currentExecutable, ref string migrationMessage)
        {
            if (string.IsNullOrEmpty(shortcutPath) || !File.Exists(shortcutPath)) return true;
            ShortcutSnapshot snapshot;
            if (!TryRead(shortcutPath, out snapshot))
            {
                migrationMessage = "无法读取 Local Codex Bridge 快捷方式，未自动覆盖现有文件：" + shortcutPath;
                return false;
            }
            if (IsCurrent(snapshot, currentExecutable)) return true;
            if (!CanAutoMigrate(shortcutPath, snapshot))
            {
                migrationMessage = "检测到 Local Codex Bridge 快捷方式目标冲突，未自动覆盖现有文件：" + shortcutPath;
                return false;
            }
            if (TryWrite(shortcutPath, currentExecutable)) return true;
            migrationMessage = "无法安全更新 Local Codex Bridge 快捷方式，未覆盖现有文件：" + shortcutPath;
            return false;
        }

        private static bool IsCurrent(ShortcutSnapshot snapshot, string currentExecutable)
        {
            return snapshot != null
                && SamePath(snapshot.TargetPath, currentExecutable)
                && string.IsNullOrWhiteSpace(snapshot.Arguments);
        }

        private static bool CanAutoMigrate(string shortcutPath, ShortcutSnapshot snapshot)
        {
            if (snapshot == null) return false;
            if (IsBridgePath(snapshot.TargetPath)) return true;
            if (string.IsNullOrWhiteSpace(snapshot.TargetPath)) return true;
            try { return !File.Exists(snapshot.TargetPath) && IsCanonicalShortcut(shortcutPath); } catch { return false; }
        }

        private static bool IsCanonicalShortcut(string shortcutPath)
        {
            return string.Equals(
                Path.GetFileName(shortcutPath),
                "Local Codex Bridge.lnk",
                StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsBridgePath(string path)
        {
            string value = (path ?? "").ToLowerInvariant();
            return value.IndexOf("localcodexbridge", StringComparison.Ordinal) >= 0
                || value.IndexOf("bridgecodex", StringComparison.Ordinal) >= 0
                || value.IndexOf("local codex bridge", StringComparison.Ordinal) >= 0;
        }

        private static bool SamePath(string left, string right)
        {
            try
            {
                return string.Equals(
                    Path.GetFullPath((left ?? "").Trim().Trim('"')).TrimEnd('\\'),
                    Path.GetFullPath((right ?? "").Trim().Trim('"')).TrimEnd('\\'),
                    StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        private static bool TryRead(string path, out ShortcutSnapshot snapshot)
        {
            snapshot = null;
            object shell = null;
            object shortcut = null;
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell", false);
                if (shellType == null) return false;
                shell = Activator.CreateInstance(shellType);
                shortcut = InvokeCom(shell, "CreateShortcut", BindingFlags.InvokeMethod, new object[] { path });
                if (shortcut == null) return false;
                Type shortcutType = shortcut.GetType();
                snapshot = new ShortcutSnapshot
                {
                    TargetPath = Convert.ToString(InvokeCom(shortcut, "TargetPath", BindingFlags.GetProperty, null)),
                    Arguments = Convert.ToString(InvokeCom(shortcut, "Arguments", BindingFlags.GetProperty, null))
                };
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                ReleaseCom(shortcut);
                ReleaseCom(shell);
            }
        }

        private static bool TryWrite(string path, string executable)
        {
            object shell = null;
            object shortcut = null;
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell", false);
                if (shellType == null) return false;
                shell = Activator.CreateInstance(shellType);
                shortcut = InvokeCom(shell, "CreateShortcut", BindingFlags.InvokeMethod, new object[] { path });
                if (shortcut == null) return false;
                InvokeCom(shortcut, "TargetPath", BindingFlags.SetProperty, new object[] { executable });
                InvokeCom(shortcut, "Arguments", BindingFlags.SetProperty, new object[] { "" });
                InvokeCom(shortcut, "WorkingDirectory", BindingFlags.SetProperty, new object[] { Path.GetDirectoryName(executable) });
                InvokeCom(shortcut, "Description", BindingFlags.SetProperty, new object[] { "Local Codex Bridge" });
                InvokeCom(shortcut, "IconLocation", BindingFlags.SetProperty, new object[] { executable + ",0" });
                InvokeCom(shortcut, "Save", BindingFlags.InvokeMethod, new object[0]);
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                ReleaseCom(shortcut);
                ReleaseCom(shell);
            }
        }

        private static object InvokeCom(object instance, string name, BindingFlags operation, object[] arguments)
        {
            if (instance == null) return null;
            BindingFlags flags = operation | BindingFlags.Public | BindingFlags.Instance;
            return instance.GetType().InvokeMember(name, flags, null, instance, arguments);
        }

        private static void ReleaseCom(object value)
        {
            try { if (value != null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); } catch { }
        }

        internal static int RunSelfTestCode()
        {
            string root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "LocalCodexBridge.Shortcut.self-test." + Guid.NewGuid().ToString("N"));
            string correct = Path.Combine(root, "Local Codex Bridge.lnk");
            string old = Path.Combine(root, "old-bridge.lnk");
            try
            {
                Directory.CreateDirectory(root);
                string executable = Application.ExecutablePath;
                if (!TryWrite(correct, executable)) return 81;
                ShortcutSnapshot before;
                if (!TryRead(correct, out before) || !IsCurrent(before, executable)) return 82;
                string message = "";
                if (!EnsureCurrent(correct, executable, ref message) || !string.IsNullOrEmpty(message)) return 83;
                ShortcutSnapshot after;
                if (!TryRead(correct, out after) || !IsCurrent(after, executable)) return 84;
                if (!TryWrite(old, "C:\\Old\\BridgeCodex-V6-Preview.exe")) return 85;
                message = "";
                if (!EnsureCurrent(old, executable, ref message)) return 86;
                if (!TryRead(old, out after) || !IsCurrent(after, executable) || !string.IsNullOrEmpty(message)) return 87;
                return 0;
            }
            catch
            {
                return 88;
            }
            finally
            {
                try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
            }
        }
    }

    internal static class DesktopInstanceSignal
    {
        internal static EventWaitHandle Create(string name)
        {
            bool created;
            return new EventWaitHandle(false, EventResetMode.ManualReset, name, out created);
        }

        internal static bool Signal(string name)
        {
            try
            {
                EventWaitHandle signal = EventWaitHandle.OpenExisting(name);
                try { return signal.Set(); }
                finally { signal.Dispose(); }
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                return false;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
        }

        internal static bool Signal(string name, string fallbackFile)
        {
            bool signaled = false;
            try
            {
                string directory = Path.GetDirectoryName(fallbackFile);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(fallbackFile, DateTime.UtcNow.ToString("o"), Encoding.UTF8);
            }
            catch
            {
            }
            signaled = Signal(name);
            // The file is intentionally written before the named event.  If
            // the event is observed while the UI thread is busy, the UI timer
            // still has a durable signal to consume.
            if (!signaled)
            {
                try { if (File.Exists(fallbackFile)) File.Delete(fallbackFile); } catch { }
            }
            return signaled;
        }

        internal static int RunSelfTestCode()
        {
            string name = "Local\\BridgeCodex.V6Preview.SelfTest." + Guid.NewGuid().ToString("N");
            try
            {
                using (EventWaitHandle signal = Create(name))
                {
                    if (!Signal(name)) return 1;
                    if (!signal.WaitOne(0)) return 2;
                }
                return 0;
            }
            catch
            {
                return 3;
            }
        }
    }

    internal sealed class WindowPlacement
    {
        internal FormWindowState State;
        internal Rectangle NormalBounds;
    }

    internal static class WindowStateStore
    {
        private const int MinimumVisibleWidth = 96;
        private const int MinimumVisibleHeight = 96;

        internal static void ApplyInitial(Form form)
        {
            if (!DesktopPaths.IsPreview || form == null) return;
            WindowPlacement placement = Load(form);
            if (placement == null)
            {
                form.WindowState = FormWindowState.Maximized;
                return;
            }
            form.StartPosition = FormStartPosition.Manual;
            form.Bounds = placement.NormalBounds;
            form.WindowState = placement.State;
        }

        internal static bool Save(Form form)
        {
            if (!DesktopPaths.IsPreview || form == null || form.IsDisposed || form.Disposing || !form.IsHandleCreated) return false;
            if (form.WindowState == FormWindowState.Minimized) return false;
            Rectangle bounds = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
            if (!IsValidBounds(form, bounds)) return false;
            try
            {
                Directory.CreateDirectory(DesktopPaths.Root);
                Dictionary<string, object> root = new Dictionary<string, object>();
                root["schemaVersion"] = 1;
                root["windowState"] = form.WindowState == FormWindowState.Maximized ? "Maximized" : "Normal";
                root["normalBounds"] = BoundsDictionary(bounds);
                root["updatedAt"] = DateTime.UtcNow.ToString("o");
                string temporary = DesktopPaths.WindowStateFile + "." + Process.GetCurrentProcess().Id + ".tmp";
                File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(root) + Environment.NewLine, new UTF8Encoding(false));
                if (File.Exists(DesktopPaths.WindowStateFile)) File.Replace(temporary, DesktopPaths.WindowStateFile, DesktopPaths.WindowStateFile + ".bak", true);
                else File.Move(temporary, DesktopPaths.WindowStateFile);
                return true;
            }
            catch
            {
                return false;
            }
        }

        internal static WindowPlacement Load(Form form)
        {
            if (!DesktopPaths.IsPreview || form == null || !File.Exists(DesktopPaths.WindowStateFile)) return null;
            try
            {
                object parsed = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(DesktopPaths.WindowStateFile, Encoding.UTF8));
                Dictionary<string, object> root = parsed as Dictionary<string, object>;
                if (root == null) return null;
                int schemaVersion;
                if (!TryReadInt(root, "schemaVersion", out schemaVersion) || schemaVersion != 1) return null;
                string stateText = root.ContainsKey("windowState") ? Convert.ToString(root["windowState"]) : "";
                FormWindowState state;
                if (string.Equals(stateText, "Maximized", StringComparison.OrdinalIgnoreCase)) state = FormWindowState.Maximized;
                else if (string.Equals(stateText, "Normal", StringComparison.OrdinalIgnoreCase)) state = FormWindowState.Normal;
                else return null;
                Dictionary<string, object> boundsValue = root.ContainsKey("normalBounds") ? root["normalBounds"] as Dictionary<string, object> : null;
                Rectangle bounds;
                if (!TryReadBounds(boundsValue, out bounds) || !IsValidBounds(form, bounds)) return null;
                return new WindowPlacement { State = state, NormalBounds = bounds };
            }
            catch
            {
                return null;
            }
        }

        private static Dictionary<string, object> BoundsDictionary(Rectangle bounds)
        {
            Dictionary<string, object> value = new Dictionary<string, object>();
            value["x"] = bounds.X;
            value["y"] = bounds.Y;
            value["width"] = bounds.Width;
            value["height"] = bounds.Height;
            return value;
        }

        private static bool TryReadBounds(Dictionary<string, object> value, out Rectangle bounds)
        {
            bounds = Rectangle.Empty;
            if (value == null) return false;
            int x;
            int y;
            int width;
            int height;
            if (!TryReadInt(value, "x", out x) || !TryReadInt(value, "y", out y) || !TryReadInt(value, "width", out width) || !TryReadInt(value, "height", out height)) return false;
            try
            {
                bounds = new Rectangle(x, y, width, height);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool TryReadInt(Dictionary<string, object> value, string key, out int result)
        {
            result = 0;
            if (!value.ContainsKey(key)) return false;
            try { result = Convert.ToInt32(value[key]); return true; } catch { return false; }
        }

        private static bool IsValidBounds(Form form, Rectangle bounds)
        {
            if (form == null || bounds.Width <= 0 || bounds.Height <= 0) return false;
            Size minimum = form.MinimumSize;
            int minimumWidth = Math.Max(640, minimum.Width);
            int minimumHeight = Math.Max(420, minimum.Height);
            if (bounds.Width < minimumWidth || bounds.Height < minimumHeight) return false;
            Rectangle virtualScreen = SystemInformation.VirtualScreen;
            long maximumWidth = Math.Max(16384L, Math.Max(1L, virtualScreen.Width) * 2L);
            long maximumHeight = Math.Max(16384L, Math.Max(1L, virtualScreen.Height) * 2L);
            if (bounds.Width > maximumWidth || bounds.Height > maximumHeight) return false;
            try
            {
                foreach (Screen screen in Screen.AllScreens)
                {
                    Rectangle intersection = Rectangle.Intersect(bounds, screen.WorkingArea);
                    if (intersection.Width >= Math.Min(MinimumVisibleWidth, bounds.Width) && intersection.Height >= Math.Min(MinimumVisibleHeight, bounds.Height)) return true;
                }
            }
            catch
            {
            }
            return false;
        }

        internal static int RunSelfTestCode()
        {
            if (!DesktopPaths.IsPreview) return 90;
            try
            {
                if (File.Exists(DesktopPaths.WindowStateFile)) File.Delete(DesktopPaths.WindowStateFile);
                using (Form first = CreateSelfTestForm())
                {
                    ApplyInitial(first);
                    if (first.WindowState != FormWindowState.Maximized) return 1;
                }
                if (Screen.AllScreens.Length == 0) return 2;
                Rectangle work = Screen.PrimaryScreen.WorkingArea;
                int width = Math.Min(900, Math.Max(640, work.Width - 40));
                int height = Math.Min(650, Math.Max(420, work.Height - 40));
                Rectangle normalBounds = new Rectangle(work.Left + 20, work.Top + 20, width, height);
                using (Form normal = CreateSelfTestForm())
                {
                    normal.StartPosition = FormStartPosition.Manual;
                    normal.Bounds = normalBounds;
                    normal.Show();
                    normal.Hide();
                    normal.WindowState = FormWindowState.Normal;
                    if (!Save(normal)) return 3;
                }
                using (Form restored = CreateSelfTestForm())
                {
                    ApplyInitial(restored);
                    if (restored.WindowState != FormWindowState.Normal || restored.Bounds != normalBounds) return 4;
                }
                WriteSelfTestState("Maximized", normalBounds);
                using (Form maximized = CreateSelfTestForm())
                {
                    ApplyInitial(maximized);
                    if (maximized.WindowState != FormWindowState.Maximized) return 5;
                }
                WriteSelfTestState("Minimized", normalBounds);
                using (Form minimized = CreateSelfTestForm())
                {
                    ApplyInitial(minimized);
                    if (minimized.WindowState != FormWindowState.Maximized) return 6;
                }
                WriteSelfTestState("Normal", new Rectangle(100, 100, 100, 100));
                using (Form tiny = CreateSelfTestForm())
                {
                    ApplyInitial(tiny);
                    if (tiny.WindowState != FormWindowState.Maximized) return 7;
                }
                WriteSelfTestState("Normal", new Rectangle(-50000, -50000, normalBounds.Width, normalBounds.Height));
                using (Form offscreen = CreateSelfTestForm())
                {
                    ApplyInitial(offscreen);
                    if (offscreen.WindowState != FormWindowState.Maximized) return 8;
                }
                return 0;
            }
            catch
            {
                return 99;
            }
            finally
            {
                try { if (File.Exists(DesktopPaths.WindowStateFile)) File.Delete(DesktopPaths.WindowStateFile); } catch { }
            }
        }

        private static Form CreateSelfTestForm()
        {
            Form form = new Form
            {
                MinimumSize = new Size(640, 420),
                Width = 980,
                Height = 720,
                StartPosition = FormStartPosition.CenterScreen,
                AutoScaleMode = AutoScaleMode.Dpi,
                AutoScaleDimensions = new SizeF(96F, 96F)
            };
            return form;
        }

        private static void WriteSelfTestState(string state, Rectangle bounds)
        {
            Directory.CreateDirectory(DesktopPaths.Root);
            Dictionary<string, object> root = new Dictionary<string, object>();
            root["schemaVersion"] = 1;
            root["windowState"] = state;
            root["normalBounds"] = BoundsDictionary(bounds);
            File.WriteAllText(DesktopPaths.WindowStateFile, new JavaScriptSerializer().Serialize(root) + Environment.NewLine, new UTF8Encoding(false));
        }
    }

    internal static class PreviewPortAllocator
    {
        private const int FirstPort = 37930;
        private const int LastPort = 37939;

        internal static string StatusUrl()
        {
            return "http://127.0.0.1:" + FindAvailablePort().ToString() + "/api/status";
        }

        internal static int FindAvailablePort()
        {
            for (int port = FirstPort; port <= LastPort; port++)
            {
                if (IsAvailable(port)) return port;
            }
            throw new InvalidOperationException("Local Codex Bridge 没有可用的隔离 status port（37930-37939）。");
        }

        internal static bool IsAvailable(int port)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (listener != null)
                {
                    try { listener.Stop(); } catch { }
                }
            }
        }
    }

    internal static class DesktopIsolationSelfTest
    {
        internal static int Run()
        {
            bool restorePreview = DesktopPaths.IsPreview;
            DesktopPaths.Configure(false);
            string normalRoot = DesktopPaths.Root;
            string normalMutex = DesktopPaths.MutexName;
            DesktopPaths.Configure(true);
            string previewRoot = DesktopPaths.Root;
            string previewMutex = DesktopPaths.MutexName;
            if (string.Equals(normalRoot, previewRoot, StringComparison.OrdinalIgnoreCase)) return 101;
            if (string.Equals(normalMutex, previewMutex, StringComparison.Ordinal)) return 102;
            if (previewRoot.IndexOf("LocalCodexBridge", StringComparison.OrdinalIgnoreCase) >= 0) return 103;
            if (previewMutex.IndexOf("V6Preview", StringComparison.OrdinalIgnoreCase) < 0) return 104;
            int port = PreviewPortAllocator.FindAvailablePort();
            if (port == 37821 || port < 37930 || port > 37939) return 105;
            DesktopSettings settings = DesktopSettings.Default();
            if (settings.StatusUrl.IndexOf(":37821/", StringComparison.Ordinal) >= 0) return 106;
            if (!string.Equals(settings.ServiceSessionFile, Path.Combine(previewRoot, "service_sessions.json"), StringComparison.OrdinalIgnoreCase)) return 107;
            if (!string.Equals(settings.LogDirectory, DesktopPaths.LogDirectory, StringComparison.OrdinalIgnoreCase)) return 108;
            if (!string.Equals(DesktopPaths.HostStatusFile, Path.Combine(DesktopPaths.RunDirectory, "desktop-host-status.json"), StringComparison.OrdinalIgnoreCase)) return 109;
            DesktopPaths.Configure(restorePreview);
            return 0;
        }
    }

    internal sealed class DesktopSettings
    {
        internal string NodeExecutable;
        internal string CodexExecutable;
        internal string BridgeWorkingDirectory;
        internal string BridgeEntry;
        internal string StatusUrl;
        internal string TunnelReadyUrl;
        internal string TunnelExecutable;
        internal string TunnelProfile;
        internal string TunnelId;
        internal string TunnelClientVersion;
        internal string TunnelHealthUrlFile;
        internal string RuntimeKeyFile;
        internal string LogDirectory;
        internal string ServiceSessionFile;
        internal bool LaunchBridgeDirectly;
        internal bool StartTunnel;
        internal bool StartWithWindows;

        internal DesktopSettings()
        {
            NodeExecutable = "";
            CodexExecutable = "";
            BridgeWorkingDirectory = "";
            BridgeEntry = "dist\\index.js";
            StatusUrl = DesktopPaths.IsPreview ? PreviewPortAllocator.StatusUrl() : "http://127.0.0.1:37821/api/status";
            TunnelReadyUrl = "";
            TunnelExecutable = "";
            TunnelProfile = "";
            TunnelId = "";
            TunnelClientVersion = "";
            TunnelHealthUrlFile = DesktopPaths.TunnelHealthUrlFile;
            RuntimeKeyFile = DesktopPaths.RuntimeKeyFile;
            LogDirectory = DesktopPaths.LogDirectory;
            ServiceSessionFile = Path.Combine(DesktopPaths.Root, "service_sessions.json");
            LaunchBridgeDirectly = true;
            StartTunnel = false;
            StartWithWindows = false;
        }

        internal static DesktopSettings Default()
        {
            DesktopSettings settings = new DesktopSettings();
            settings.NodeExecutable = FindExecutable("node.exe");
            settings.CodexExecutable = FindExecutable("codex.exe");
            settings.BridgeWorkingDirectory = FindBridgeRoot(AppDomain.CurrentDomain.BaseDirectory);
            return settings;
        }

        internal bool IsComplete()
        {
            string entry = GetBridgeEntryPath();
            return File.Exists(NodeExecutable) && Directory.Exists(BridgeWorkingDirectory) && File.Exists(entry) && UriIsLoopback(StatusUrl);
        }

        internal string GetBridgeEntryPath()
        {
            return ResolveBridgeEntryPath(BridgeWorkingDirectory, BridgeEntry);
        }

        internal static string ResolveBridgeEntryPath(string root, string configuredEntry)
        {
            string absoluteRoot = Path.GetFullPath(root);
            string portableEntry = Path.Combine(absoluteRoot, "dist", "index.js");
            if (File.Exists(portableEntry)) return portableEntry;
            string sourceEntry = Path.Combine(absoluteRoot, "dist", "src", "index.js");
            if (File.Exists(sourceEntry)) return sourceEntry;
            if (Path.IsPathRooted(configuredEntry)) return Path.GetFullPath(configuredEntry);
            return Path.Combine(absoluteRoot, string.IsNullOrEmpty(configuredEntry) ? "dist\\index.js" : configuredEntry);
        }

        internal Dictionary<string, object> ToDictionary()
        {
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            result["schemaVersion"] = 1;
            result["nodeExecutable"] = NodeExecutable;
            result["codexExecutable"] = CodexExecutable;
            result["bridgeWorkingDirectory"] = BridgeWorkingDirectory;
            result["bridgeEntry"] = BridgeEntry;
            result["statusUrl"] = StatusUrl;
            result["tunnelReadyUrl"] = TunnelReadyUrl;
            result["tunnelExecutable"] = TunnelExecutable;
            result["tunnelProfile"] = TunnelProfile;
            result["tunnelId"] = TunnelId;
            result["tunnelClientVersion"] = TunnelClientVersion;
            result["tunnelHealthUrlFile"] = TunnelHealthUrlFile;
            result["statusUrlFile"] = DesktopPaths.StatusUrlFile;
            result["runtimeKeyFile"] = RuntimeKeyFile;
            result["logDirectory"] = LogDirectory;
            result["serviceSessionFile"] = ServiceSessionFile;
            result["previewMode"] = DesktopPaths.IsPreview;
            result["productName"] = DesktopPaths.ProductName;
            result["launchBridgeDirectly"] = LaunchBridgeDirectly;
            result["startTunnel"] = StartTunnel;
            result["startWithWindows"] = StartWithWindows;
            return result;
        }

        internal static DesktopSettings Load(out bool firstRun, out string migrationMessage)
        {
            DesktopPaths.EnsureDirectories();
            firstRun = !File.Exists(DesktopPaths.SettingsFile);
            migrationMessage = "";
            DesktopSettings settings = Default();
            string existingShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Local Codex Bridge.lnk");
            if (!DesktopPaths.IsPreview)
            {
                ShortcutMigration.EnsureCurrent(existingShortcut, Application.ExecutablePath, ref migrationMessage);
            }
            if (File.Exists(DesktopPaths.SettingsFile))
            {
                try
                {
                    object parsed = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(DesktopPaths.SettingsFile, Encoding.UTF8));
                    settings.Apply(parsed as Dictionary<string, object>);
                    settings.ApplyPackageRelativeFallback();
                    settings.ApplyPreviewIsolation();
                    if (!DesktopPaths.IsPreview) TryMigrateLegacyKey(settings, ref migrationMessage);
                    if (DesktopPaths.IsPreview) Save(settings);
                    return settings;
                }
                catch
                {
                    migrationMessage = "桌面设置文件无法读取，已保留原文件并恢复默认配置。";
                    return settings;
                }
            }

            if (!DesktopPaths.IsPreview)
            {
                string legacy = FindLegacySettings(settings.BridgeWorkingDirectory);
                if (!string.IsNullOrEmpty(legacy))
                {
                    try
                    {
                        object parsed = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(legacy, Encoding.UTF8));
                        settings.ApplyLegacy(parsed as Dictionary<string, object>);
                        migrationMessage = migrationMessage + (string.IsNullOrEmpty(migrationMessage) ? "" : " ") + "已识别旧版 local-settings.json；现有 DPAPI 密钥和 Tunnel 配置将继续复用。";
                        if (!string.IsNullOrEmpty(settings.TunnelExecutable) && !string.IsNullOrEmpty(settings.TunnelProfile))
                        {
                            settings.StartTunnel = true;
                            settings.LaunchBridgeDirectly = false;
                        }
                    }
                    catch
                    {
                        migrationMessage = "发现旧版 local-settings.json，但内容无法迁移；请在向导中重新配置。";
                    }
                }
            }
            settings.ApplyPackageRelativeFallback();
            settings.ApplyPreviewIsolation();
            if (!DesktopPaths.IsPreview) TryMigrateLegacyKey(settings, ref migrationMessage);
            Save(settings);
            return settings;
        }

        internal static void Save(DesktopSettings settings)
        {
            DesktopPaths.EnsureDirectories();
            string temporary = DesktopPaths.SettingsFile + "." + Process.GetCurrentProcess().Id + ".tmp";
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(settings.ToDictionary()) + Environment.NewLine, new UTF8Encoding(false));
            if (File.Exists(DesktopPaths.SettingsFile))
            {
                string backup = DesktopPaths.SettingsFile + ".bak";
                File.Replace(temporary, DesktopPaths.SettingsFile, backup, true);
            }
            else File.Move(temporary, DesktopPaths.SettingsFile);
        }

        internal static string FindBridgeRoot(string start)
        {
            DirectoryInfo current = new DirectoryInfo(start);
            for (int i = 0; i < 8 && current != null; i++)
            {
                if (File.Exists(Path.Combine(current.FullName, "dist", "index.js"))) return current.FullName;
                if (File.Exists(Path.Combine(current.FullName, "dist", "src", "index.js"))) return current.FullName;
                current = current.Parent;
            }
            return start;
        }

        private static string FindLegacySettings(string bridgeRoot)
        {
            List<string> candidates = new List<string>(new string[]
            {
                Path.Combine(bridgeRoot, "windows", "local-settings.json"),
                Path.Combine(DesktopPaths.Root, "local-settings.json"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LocalCodexBridge", "local-settings.json")
            });
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                if (Directory.Exists(desktop))
                {
                    string[] directories = Directory.GetDirectories(desktop, "*Codex*Bridge*", SearchOption.TopDirectoryOnly);
                    for (int i = 0; i < directories.Length; i++) candidates.Add(Path.Combine(directories[i], "windows", "local-settings.json"));
                }
            }
            catch { }
            for (int i = 0; i < candidates.Count; i++) if (File.Exists(candidates[i])) return candidates[i];
            return "";
        }

        private void Apply(Dictionary<string, object> value)
        {
            if (value == null) return;
            NodeExecutable = Text(value, "nodeExecutable", NodeExecutable);
            CodexExecutable = Text(value, "codexExecutable", CodexExecutable);
            BridgeWorkingDirectory = Text(value, "bridgeWorkingDirectory", BridgeWorkingDirectory);
            BridgeEntry = Text(value, "bridgeEntry", BridgeEntry);
            StatusUrl = Text(value, "statusUrl", StatusUrl);
            TunnelReadyUrl = Text(value, "tunnelReadyUrl", TunnelReadyUrl);
            TunnelExecutable = Text(value, "tunnelExecutable", TunnelExecutable);
            TunnelProfile = Text(value, "tunnelProfile", TunnelProfile);
            TunnelId = Text(value, "tunnelId", TunnelId);
            TunnelClientVersion = Text(value, "tunnelClientVersion", TunnelClientVersion);
            TunnelHealthUrlFile = Text(value, "tunnelHealthUrlFile", TunnelHealthUrlFile);
            RuntimeKeyFile = Text(value, "runtimeKeyFile", RuntimeKeyFile);
            LogDirectory = Text(value, "logDirectory", LogDirectory);
            ServiceSessionFile = Text(value, "serviceSessionFile", ServiceSessionFile);
            LaunchBridgeDirectly = Bool(value, "launchBridgeDirectly", LaunchBridgeDirectly);
            StartTunnel = Bool(value, "startTunnel", StartTunnel);
            StartWithWindows = Bool(value, "startWithWindows", StartWithWindows);
            NormalizePaths();
        }

        private void ApplyLegacy(Dictionary<string, object> value)
        {
            if (value == null) return;
            StatusUrl = Expand(Text(value, "statusUrl", StatusUrl));
            TunnelReadyUrl = Expand(Text(value, "readyUrl", Text(value, "tunnelReadyUrl", TunnelReadyUrl)));
            TunnelExecutable = Expand(Text(value, "tunnelExecutable", TunnelExecutable));
            TunnelProfile = Text(value, "tunnelProfile", Text(value, "profileName", TunnelProfile));
            TunnelId = Text(value, "tunnelId", TunnelId);
            TunnelClientVersion = Text(value, "tunnelClientVersion", TunnelClientVersion);
            TunnelHealthUrlFile = Expand(Text(value, "tunnelHealthUrlFile", TunnelHealthUrlFile));
            RuntimeKeyFile = Expand(Text(value, "runtimeKeyFile", RuntimeKeyFile));
            LogDirectory = Expand(Text(value, "logDirectory", LogDirectory));
            string projection = Expand(Text(value, "projectionPath", ""));
            string checkpoint = Expand(Text(value, "checkpointDirectory", ""));
            if (!string.IsNullOrEmpty(projection)) { }
            if (!string.IsNullOrEmpty(checkpoint)) { }
            NormalizePaths();
        }

        private void NormalizePaths()
        {
            NodeExecutable = Expand(NodeExecutable);
            CodexExecutable = Expand(CodexExecutable);
            BridgeWorkingDirectory = Expand(BridgeWorkingDirectory);
            TunnelExecutable = Expand(TunnelExecutable);
            TunnelHealthUrlFile = Expand(TunnelHealthUrlFile);
            RuntimeKeyFile = Expand(RuntimeKeyFile);
            LogDirectory = Expand(LogDirectory);
            ServiceSessionFile = Expand(ServiceSessionFile);
        }

        private void ApplyPackageRelativeFallback()
        {
            string packageRoot = FindBridgeRoot(AppDomain.CurrentDomain.BaseDirectory);
            bool currentBridgeValid = false;
            try { currentBridgeValid = Directory.Exists(BridgeWorkingDirectory) && File.Exists(GetBridgeEntryPath()); } catch { }
            if (!currentBridgeValid)
            {
                BridgeWorkingDirectory = packageRoot;
                BridgeEntry = "dist\\index.js";
            }
            if (!File.Exists(NodeExecutable)) NodeExecutable = FindExecutable("node.exe");
            if (!File.Exists(CodexExecutable)) CodexExecutable = FindExecutable("codex.exe");
            if (!UriIsLoopback(StatusUrl))
            {
                StatusUrl = DesktopPaths.IsPreview
                    ? PreviewPortAllocator.StatusUrl()
                    : "http://127.0.0.1:37821/api/status";
            }
        }

        private void ApplyPreviewIsolation()
        {
            if (!DesktopPaths.IsPreview) return;
            ApplyPackageRelativeFallback();
            BridgeWorkingDirectory = FindBridgeRoot(AppDomain.CurrentDomain.BaseDirectory);
            BridgeEntry = "dist\\index.js";
            Uri status;
            bool samePackageBridge = ProcessInspector.FindPreviewBridgeCandidates(
                NodeExecutable,
                Path.Combine(BridgeWorkingDirectory, "dist", "index.js")).Count == 1;
            bool validStatus = Uri.TryCreate(StatusUrl, UriKind.Absolute, out status)
                && status.Scheme == Uri.UriSchemeHttp
                && (status.Host == "127.0.0.1" || status.Host == "localhost")
                && status.Port >= 37930
                && status.Port <= 37939
                && (PreviewPortAllocator.IsAvailable(status.Port) || samePackageBridge);
            if (!validStatus) StatusUrl = PreviewPortAllocator.StatusUrl();
            TunnelReadyUrl = "";
            if (!File.Exists(TunnelExecutable)) TunnelExecutable = V6TunnelProfile.BundledClientPath();
            TunnelProfile = "local-codex-bridge-v6";
            TunnelId = V6TunnelProfile.ReadTunnelId();
            TunnelClientVersion = V6TunnelProfile.ReadClientVersion();
            TunnelHealthUrlFile = DesktopPaths.TunnelHealthUrlFile;
            RuntimeKeyFile = DesktopPaths.RuntimeKeyFile;
            LogDirectory = DesktopPaths.LogDirectory;
            ServiceSessionFile = Path.Combine(DesktopPaths.Root, "service_sessions.json");
            LaunchBridgeDirectly = true;
            StartTunnel = File.Exists(TunnelExecutable)
                && File.Exists(V6TunnelProfile.TemplatePath())
                && File.Exists(RuntimeKeyFile)
                && !string.IsNullOrEmpty(TunnelId);
            StartWithWindows = false;
        }

        private static void TryMigrateLegacyKey(DesktopSettings settings, ref string message)
        {
            if (string.IsNullOrEmpty(settings.RuntimeKeyFile) || !File.Exists(settings.RuntimeKeyFile))
            {
                string[] legacyCandidates = new string[]
                {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LocalCodexBridge", "runtime_key_v5.securestring"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LocalCodexBridge", "runtime_key_v5.securestring"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LocalCodexBridge", "control_plane_api_key.dpapi")
                };
                for (int i = 0; i < legacyCandidates.Length; i++)
                {
                    if (File.Exists(legacyCandidates[i])) { settings.RuntimeKeyFile = legacyCandidates[i]; break; }
                }
            }
            if (string.IsNullOrEmpty(settings.RuntimeKeyFile) || !File.Exists(settings.RuntimeKeyFile)) return;
            if (!settings.RuntimeKeyFile.EndsWith(".securestring", StringComparison.OrdinalIgnoreCase)) return;
            try
            {
                string clear = SecureStore.Read(settings.RuntimeKeyFile);
                if (!string.IsNullOrEmpty(clear))
                {
                    SecureStore.Save(DesktopPaths.RuntimeKeyFile, clear);
                    settings.RuntimeKeyFile = DesktopPaths.RuntimeKeyFile;
                    message = message + " 已将旧版 DPAPI 密钥迁移到当前用户安全存储。";
                }
            }
            catch
            {
                message = message + " 旧版 DPAPI 密钥未能自动迁移，请在向导中重新输入；旧文件未修改。";
            }
        }

        private static string Text(Dictionary<string, object> value, string key, string fallback)
        {
            object item;
            if (value.TryGetValue(key, out item) && item != null && item is string) return (string)item;
            return fallback;
        }

        private static bool Bool(Dictionary<string, object> value, string key, bool fallback)
        {
            object item;
            if (value.TryGetValue(key, out item) && item is bool) return (bool)item;
            return fallback;
        }

        private static string Expand(string value)
        {
            return string.IsNullOrEmpty(value) ? "" : Environment.ExpandEnvironmentVariables(value.Trim());
        }

        private static string FindExecutable(string name)
        {
            string explicitPath = Environment.GetEnvironmentVariable(name == "node.exe" ? "LOCAL_CODEX_BRIDGE_NODE_EXE" : "CODEX_EXE");
            if (!string.IsNullOrEmpty(explicitPath) && File.Exists(explicitPath)) return Path.GetFullPath(explicitPath);
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] parts = path.Split(new char[] { Path.PathSeparator }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
            {
                string candidate = Path.Combine(parts[i].Trim(), name);
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
            }
            return "";
        }

        private static bool UriIsLoopback(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri)) return false;
            return uri.Scheme == Uri.UriSchemeHttp && (uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "::1");
        }
    }

    internal static class V6TunnelProfile
    {
        private const string TunnelIdPrefix = "tunnel_";
        private const string CommandPlaceholder = "__MCP_COMMAND__";

        internal static string BundledClientPath()
        {
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tunnel-client.exe");
        }

        internal static string TemplatePath()
        {
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tunnel-profile.template.yaml");
        }

        internal static string VersionPath()
        {
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tunnel-client.version.txt");
        }

        internal static string ReadTunnelId()
        {
            try
            {
                // User configuration is private, survives upgrades, and must not
                // be baked into the distributable template. Keep old bound
                // templates readable for existing installations only.
                if (File.Exists(DesktopPaths.SettingsFile))
                {
                    Dictionary<string, object> settings = new JavaScriptSerializer().DeserializeObject(
                        File.ReadAllText(DesktopPaths.SettingsFile, Encoding.UTF8)) as Dictionary<string, object>;
                    object configured;
                    if (settings != null && settings.TryGetValue("tunnelId", out configured)
                        && configured is string && !string.IsNullOrWhiteSpace((string)configured))
                        return IsTunnelId((string)configured) ? (string)configured : "";
                }
                if (!File.Exists(TemplatePath())) return "";
                string[] lines = File.ReadAllLines(TemplatePath(), Encoding.UTF8);
                for (int i = 0; i < lines.Length; i++)
                {
                    string line = lines[i].Trim();
                    if (!line.StartsWith("tunnel_id:", StringComparison.OrdinalIgnoreCase)) continue;
                    string value = line.Substring("tunnel_id:".Length).Trim().Trim('"', '\'');
                    return IsTunnelId(value) ? value : "";
                }
            }
            catch
            {
            }
            return "";
        }

        internal static string ReadClientVersion()
        {
            try
            {
                if (File.Exists(VersionPath()))
                {
                    string value = File.ReadAllText(VersionPath(), Encoding.UTF8).Trim();
                    if (!string.IsNullOrEmpty(value)) return value;
                }
            }
            catch
            {
            }
            return "unknown";
        }

        internal static void WriteRuntimeProfile(string runtimePath, string bridgeEntry)
        {
            WriteRuntimeProfile(runtimePath, bridgeEntry, DesktopSettings.Default().NodeExecutable);
        }

        internal static void WriteRuntimeProfile(string runtimePath, string bridgeEntry, string nodeExecutable)
        {
            if (string.IsNullOrEmpty(runtimePath)) throw new InvalidOperationException("V6 Tunnel profile path is empty.");
            if (!File.Exists(TemplatePath())) throw new InvalidOperationException("未找到 V6 Tunnel profile 模板。");
            string template = File.ReadAllText(TemplatePath(), Encoding.UTF8);
            string tunnelId = ReadTunnelId();
            if (string.IsNullOrEmpty(tunnelId)) throw new InvalidOperationException("V6 Tunnel profile 缺少有效 tunnel ID。");
            if (string.IsNullOrWhiteSpace(nodeExecutable)) throw new InvalidOperationException("Node.js executable is not configured.");
            // Quote both tokens for the Tunnel command parser, then escape the
            // command for the surrounding YAML string (paths may contain spaces).
            string command = ("\"" + nodeExecutable.Replace('\\', '/') + "\" \""
                + (bridgeEntry ?? "").Replace('\\', '/') + "\"").Replace("\"", "\\\"");
            if (string.IsNullOrEmpty(bridgeEntry) || template.IndexOf(CommandPlaceholder, StringComparison.Ordinal) < 0)
                throw new InvalidOperationException("V6 Tunnel profile 模板缺少 MCP command 占位符。");
            string runtime = template.Replace(CommandPlaceholder, command);
            runtime = System.Text.RegularExpressions.Regex.Replace(runtime,
                "(?m)^(\\s*tunnel_id:\\s*)[^\\r\\n]*", delegate(System.Text.RegularExpressions.Match match)
                { return match.Groups[1].Value + "\"" + tunnelId + "\""; });
            if (runtime.IndexOf("__", StringComparison.Ordinal) >= 0) throw new InvalidOperationException("V6 Tunnel profile 模板仍包含未替换占位符。");
            string temporary = runtimePath + "." + Process.GetCurrentProcess().Id.ToString() + ".tmp";
            Directory.CreateDirectory(Path.GetDirectoryName(runtimePath));
            File.WriteAllText(temporary, runtime, new UTF8Encoding(false));
            if (File.Exists(runtimePath)) File.Replace(temporary, runtimePath, null, true);
            else File.Move(temporary, runtimePath);
        }

        internal static bool IsTunnelId(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length != TunnelIdPrefix.Length + 32 || !value.StartsWith(TunnelIdPrefix, StringComparison.Ordinal)) return false;
            for (int i = TunnelIdPrefix.Length; i < value.Length; i++)
            {
                char ch = value[i];
                if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return false;
            }
            return true;
        }

        internal static int RunConfigurationSelfTestCode()
        {
            // DesktopSelfTest has already selected its unique isolated state root.
            string id = TunnelIdPrefix + new string('a', 32);
            if (!IsTunnelId(id) || IsTunnelId("tunnel_UNCONFIGURED") || IsTunnelId(id + "\n")
                || IsTunnelId(id.Replace('a', 'G'))) return 181;
            DesktopSettings settings = DesktopSettings.Default();
            settings.TunnelId = id;
            DesktopSettings.Save(settings);
            if (ReadTunnelId() != id) return 182;
            if (File.Exists(TemplatePath()))
            {
                string templateBefore = File.ReadAllText(TemplatePath(), Encoding.UTF8);
                string profile = Path.Combine(DesktopPaths.RunDirectory, "configuration-self-test.yaml");
                WriteRuntimeProfile(profile, Path.Combine(DesktopPaths.Root, "project with spaces", "dist", "index.js"), "C:\\Program Files\\nodejs\\node.exe");
                string result = File.ReadAllText(profile, Encoding.UTF8);
                if (result.IndexOf("\\\"C:/Program Files/nodejs/node.exe\\\"", StringComparison.Ordinal) < 0
                    || result.IndexOf(id, StringComparison.Ordinal) < 0 || result.IndexOf(CommandPlaceholder, StringComparison.Ordinal) >= 0
                    || result.IndexOf("tunnel_UNCONFIGURED", StringComparison.Ordinal) >= 0) return 183;
                if (File.ReadAllText(TemplatePath(), Encoding.UTF8) != templateBefore) return 184;
            }
            SecureStore.Save(DesktopPaths.RuntimeKeyFile, "self-test-not-a-real-api-key");
            if (SecureStore.Read(DesktopPaths.RuntimeKeyFile) != "self-test-not-a-real-api-key") return 185;
            if (File.ReadAllText(DesktopPaths.RuntimeKeyFile).IndexOf("self-test-not-a-real-api-key", StringComparison.Ordinal) >= 0) return 186;
            settings.TunnelId = "invalid";
            DesktopSettings.Save(settings);
            if (ReadTunnelId() != "") return 187; // invalid overrides fail closed
            // Failure before Process.Start (missing dependency/locked key) must
            // not leave a persisted starting/registering state indefinitely.
            settings.TunnelExecutable = Path.Combine(DesktopPaths.Root, "missing-tunnel.exe");
            BridgeProcessController failedController = new BridgeProcessController(settings);
            try
            {
                MethodInfo start = typeof(BridgeProcessController).GetMethod("StartTunnel", BindingFlags.Instance | BindingFlags.NonPublic);
                try { start.Invoke(failedController, null); return 188; }
                catch (TargetInvocationException) { }
                Dictionary<string, object> failed = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(DesktopPaths.TunnelStateFile));
                if ((string)failed["status"] != "error" || (string)failed["registration"] != "failed"
                    || string.IsNullOrEmpty((string)failed["last_error"])) return 189;
            }
            finally { failedController.Close(); }
            File.Delete(DesktopPaths.SettingsFile);
            File.Delete(DesktopPaths.RuntimeKeyFile);
            return 0;
        }
    }

    internal static class SecureStore
    {
        internal static void Save(string path, string clearText)
        {
            if (string.IsNullOrEmpty(clearText)) throw new InvalidOperationException("Runtime API Key 不能为空。");
            byte[] cipher = ProtectedData.Protect(Encoding.UTF8.GetBytes(clearText), null, DataProtectionScope.CurrentUser);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, Convert.ToBase64String(cipher), Encoding.ASCII);
            File.SetAttributes(path, FileAttributes.Hidden);
        }

        internal static string Read(string path)
        {
            string encoded = File.ReadAllText(path, Encoding.UTF8).Trim();
            try
            {
                byte[] cipher = Convert.FromBase64String(encoded);
                return Encoding.UTF8.GetString(ProtectedData.Unprotect(cipher, null, DataProtectionScope.CurrentUser));
            }
            catch
            {
                return ReadPowerShellSecureString(path);
            }
        }

        private static string ReadPowerShellSecureString(string path)
        {
            string escaped = path.Replace("'", "''");
            string command = "$cipher=Get-Content -Raw -LiteralPath '" + escaped + "'; $secure=ConvertTo-SecureString -String $cipher; $plain=[Net.NetworkCredential]::new('', $secure).Password; [Console]::Out.Write($plain)";
            ProcessStartInfo start = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -Command \"" + command.Replace("\"", "\\\"") + "\"");
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            using (Process process = Process.Start(start))
            {
                if (!process.WaitForExit(7000))
                {
                    try { process.Kill(); } catch { }
                    throw new InvalidOperationException("无法读取当前用户 DPAPI 密钥。");
                }
                string result = process.StandardOutput.ReadToEnd().Trim();
                if (process.ExitCode != 0 || string.IsNullOrEmpty(result)) throw new InvalidOperationException("无法读取当前用户 DPAPI 密钥。");
                return result;
            }
        }
    }

    internal sealed class StatusSnapshot
    {
        internal readonly string Raw;
        private readonly Dictionary<string, object> Root;

        private StatusSnapshot(string raw, Dictionary<string, object> root)
        {
            Raw = raw;
            Root = root;
        }

        internal static StatusSnapshot Read(string url)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Timeout = 1800;
            request.ReadWriteTimeout = 1800;
            request.Proxy = null;
            using (WebResponse response = request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                string raw = reader.ReadToEnd();
                object parsed = new JavaScriptSerializer().DeserializeObject(raw);
                Dictionary<string, object> root = parsed as Dictionary<string, object>;
                if (root == null) throw new InvalidDataException("Bridge status is not a JSON object.");
                return new StatusSnapshot(raw, root);
            }
        }

        internal static bool Probe(string url)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 1800;
                request.ReadWriteTimeout = 1800;
                request.Proxy = null;
                using (WebResponse response = request.GetResponse()) return ((HttpWebResponse)response).StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        internal object Value(params string[] path)
        {
            object current = Root;
            for (int i = 0; i < path.Length; i++)
            {
                Dictionary<string, object> dictionary = current as Dictionary<string, object>;
                if (dictionary == null) return null;
                if (!dictionary.TryGetValue(path[i], out current)) return null;
            }
            return current;
        }

        internal string Text(params string[] path)
        {
            object value = Value(path);
            return value == null ? "" : Convert.ToString(value);
        }

        internal int Number(params string[] path)
        {
            int result;
            return int.TryParse(Text(path), out result) ? result : 0;
        }

        internal bool BridgeHealthy
        {
            get { return string.Equals(Text("bridge", "status"), "running", StringComparison.OrdinalIgnoreCase); }
        }

        internal string SafeDiagnostics(string tunnelState, string bridgeOwnership, string tunnelOwnership)
        {
            return SafeDiagnostics(tunnelState, bridgeOwnership, tunnelOwnership, true);
        }

        internal string SafeDiagnostics(string tunnelState, string bridgeOwnership, string tunnelOwnership, bool includeCapturedAt)
        {
            Dictionary<string, object> safe = new Dictionary<string, object>();
            if (includeCapturedAt) safe["captured_at"] = DateTime.UtcNow.ToString("o");
            safe["bridge"] = Text("bridge", "status");
            safe["bridge_pid"] = Text("bridge", "pid");
            safe["app_server"] = Text("appServer", "status", "process_state");
            safe["app_server_pid"] = Text("appServer", "status", "app_server_pid");
            safe["model_policy"] = Text("modelPolicy", "policy_model") + "/" + Text("modelPolicy", "policy_effort");
            safe["model_guard"] = Text("modelPolicy", "guard_status");
            safe["bridge_agent"] = Text("bridgeAgent", "status");
            safe["service_sessions"] = Text("bridgeAgent", "active_sessions");
            safe["workers"] = Text("workers", "running") + "/" + Text("workers", "max");
            safe["native_active"] = Text("workers", "native_active");
            safe["queue"] = Text("queue", "depth");
            safe["pending_confirmation"] = Text("dashboard", "pending_confirmation_count");
            safe["tunnel"] = tunnelState;
            safe["tunnel_parent_pid"] = Text("tunnel", "parent_pid");
            safe["tunnel_mcp_child_pid"] = Text("tunnel", "mcp_child_pid");
            safe["tunnel_process_alive"] = Text("tunnel", "parent_process_alive");
            safe["tunnel_mcp_child_alive"] = Text("tunnel", "mcp_child_alive");
            safe["tunnel_health_probe"] = Text("tunnel", "health_probe");
            safe["tunnel_registration"] = Text("tunnel", "registration");
            safe["tunnel_transport"] = Text("tunnel", "transport_status");
            safe["tunnel_last_disconnect_reason"] = Text("tunnel", "last_disconnect_reason");
            safe["tunnel_restart_attempt"] = Text("tunnel", "restart_attempt");
            safe["tunnel_state_updated"] = Text("tunnel", "state_updated_at");
            safe["mcp_last_initialize"] = Text("mcp", "last_initialize_at");
            safe["mcp_last_tools_list"] = Text("mcp", "last_tools_list_at");
            safe["bridge_ownership"] = bridgeOwnership;
            safe["tunnel_ownership"] = tunnelOwnership;
            safe["status_url"] = "loopback-only";
            return new JavaScriptSerializer().Serialize(safe) + Environment.NewLine;
        }
    }

    internal sealed class DashboardViewState
    {
        internal readonly bool BridgeHealthy;
        internal readonly string BridgeText;
        internal readonly string TunnelText;
        internal readonly string AppServerText;
        internal readonly string ModelText;
        internal readonly string AgentText;
        internal readonly string WorkerText;
        internal readonly string NativeText;
        internal readonly string QueueText;
        internal readonly string PendingText;
        internal readonly string OwnershipText;
        internal readonly string TasksText;
        internal readonly string DiagnosticsText;

        private DashboardViewState(
            bool bridgeHealthy,
            string bridgeText,
            string tunnelText,
            string appServerText,
            string modelText,
            string agentText,
            string workerText,
            string nativeText,
            string queueText,
            string pendingText,
            string ownershipText,
            string tasksText,
            string diagnosticsText)
        {
            BridgeHealthy = bridgeHealthy;
            BridgeText = bridgeText;
            TunnelText = tunnelText;
            AppServerText = appServerText;
            ModelText = modelText;
            AgentText = agentText;
            WorkerText = workerText;
            NativeText = nativeText;
            QueueText = queueText;
            PendingText = pendingText;
            OwnershipText = ownershipText;
            TasksText = tasksText;
            DiagnosticsText = diagnosticsText;
        }

        internal static DashboardViewState From(StatusSnapshot snapshot, string tunnelState, string bridgeOwnership, string tunnelOwnership)
        {
            if (snapshot == null)
            {
                return new DashboardViewState(
                    false,
                    "未连接",
                    tunnelState,
                    "不可用",
                    "未知",
                    "未读取",
                    "0 / 5",
                    "0",
                    "0",
                    "0",
                    bridgeOwnership + " / " + tunnelOwnership,
                    "暂无状态快照。",
                    "等待 Bridge/Tunnel 就绪；不会自动重启或停止外部实例。");
            }

            return new DashboardViewState(
                snapshot.BridgeHealthy,
                snapshot.Text("bridge", "status"),
                tunnelState,
                snapshot.Text("appServer", "status", "process_state"),
                snapshot.Text("modelPolicy", "policy_model") + " / " + snapshot.Text("modelPolicy", "policy_effort") + " / " + snapshot.Text("modelPolicy", "guard_status"),
                snapshot.Text("bridgeAgent", "name") + " · " + snapshot.Text("bridgeAgent", "status") + " · sessions=" + snapshot.Text("bridgeAgent", "active_sessions"),
                snapshot.Text("workers", "running") + " / " + snapshot.Text("workers", "max"),
                snapshot.Text("workers", "native_active"),
                snapshot.Text("queue", "depth"),
                snapshot.Text("dashboard", "pending_confirmation_count"),
                bridgeOwnership + " / " + tunnelOwnership,
                TaskText(snapshot),
                snapshot.SafeDiagnostics(tunnelState, bridgeOwnership, tunnelOwnership, false));
        }

        internal static DashboardViewState ForSelfTest()
        {
            return new DashboardViewState(
                true,
                "running",
                "ready",
                "running",
                "gpt-5.6-luna / max / READY",
                "Bridge Agent · ready · sessions=1",
                "0 / 5",
                "0",
                "0",
                "0",
                "bridge / external",
                "暂无任务。",
                "{\"bridge\":\"running\",\"workers\":\"0/5\"}");
        }

        private static string TaskText(StatusSnapshot snapshot)
        {
            StringBuilder output = new StringBuilder();
            AppendTasks(output, snapshot.Value("tasks", "current"), "当前");
            AppendArray(output, snapshot.Value("tasks", "active"), "执行中");
            AppendArray(output, snapshot.Value("tasks", "waiting"), "排队");
            AppendArray(output, snapshot.Value("tasks", "recent_completed"), "最近完成");
            return output.Length == 0 ? "暂无任务。" : output.ToString();
        }

        private static void AppendArray(StringBuilder output, object value, string label)
        {
            object[] items = value as object[];
            if (items == null) return;
            for (int i = 0; i < items.Length && i < 8; i++) AppendTasks(output, items[i], label);
        }

        private static void AppendTasks(StringBuilder output, object value, string label)
        {
            Dictionary<string, object> item = value as Dictionary<string, object>;
            if (item == null) return;
            string name = item.ContainsKey("name") ? Convert.ToString(item["name"]) : "";
            string status = item.ContainsKey("status") ? Convert.ToString(item["status"]) : "";
            string thread = item.ContainsKey("thread_id") ? Convert.ToString(item["thread_id"]) : "";
            if (!string.IsNullOrEmpty(name)) output.AppendLine(label + " · " + name + " · " + status + (string.IsNullOrEmpty(thread) ? "" : " · thread=" + thread));
        }
    }

    internal sealed class ProcessOwnership
    {
        internal string Role;
        internal int ProcessId;
        internal string ExecutablePath;
        internal long StartUtcTicks;
        internal string Signature;
        internal string Profile;
        internal string PidFile;
        internal int ParentProcessId;
        internal long ParentStartUtcTicks;

        internal Dictionary<string, object> ToDictionary()
        {
            Dictionary<string, object> value = new Dictionary<string, object>();
            value["role"] = Role;
            value["pid"] = ProcessId;
            value["executable_path"] = ExecutablePath;
            value["start_utc_ticks"] = StartUtcTicks;
            value["signature"] = Signature;
            value["profile"] = Profile;
            value["pid_file"] = PidFile;
            value["parent_pid"] = ParentProcessId;
            value["parent_start_utc_ticks"] = ParentStartUtcTicks;
            return value;
        }

        internal static ProcessOwnership FromDictionary(Dictionary<string, object> value)
        {
            if (value == null) return null;
            int pid;
            long ticks;
            int parentPid;
            long parentTicks;
            if (!int.TryParse(Convert.ToString(value.ContainsKey("pid") ? value["pid"] : ""), out pid)) return null;
            if (!long.TryParse(Convert.ToString(value.ContainsKey("start_utc_ticks") ? value["start_utc_ticks"] : ""), out ticks)) return null;
            int.TryParse(Convert.ToString(value.ContainsKey("parent_pid") ? value["parent_pid"] : ""), out parentPid);
            long.TryParse(Convert.ToString(value.ContainsKey("parent_start_utc_ticks") ? value["parent_start_utc_ticks"] : ""), out parentTicks);
            return new ProcessOwnership
            {
                Role = Convert.ToString(value.ContainsKey("role") ? value["role"] : ""),
                ProcessId = pid,
                ExecutablePath = Convert.ToString(value.ContainsKey("executable_path") ? value["executable_path"] : ""),
                StartUtcTicks = ticks,
                Signature = Convert.ToString(value.ContainsKey("signature") ? value["signature"] : ""),
                Profile = Convert.ToString(value.ContainsKey("profile") ? value["profile"] : ""),
                PidFile = Convert.ToString(value.ContainsKey("pid_file") ? value["pid_file"] : ""),
                ParentProcessId = parentPid,
                ParentStartUtcTicks = parentTicks
            };
        }
    }

    internal static class ProcessInspector
    {
        internal static string ExecutablePath(int pid)
        {
            try
            {
                string query = "SELECT ExecutablePath FROM Win32_Process WHERE ProcessId = " + pid.ToString();
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(query))
                using (ManagementObjectCollection results = searcher.Get())
                {
                    foreach (ManagementObject result in results) return Convert.ToString(result["ExecutablePath"]);
                }
            }
            catch { }
            return "";
        }

        internal static string CommandLine(int pid)
        {
            try
            {
                string query = "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid.ToString();
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(query))
                using (ManagementObjectCollection results = searcher.Get())
                {
                    foreach (ManagementObject result in results) return Convert.ToString(result["CommandLine"]);
                }
            }
            catch { }
            return "";
        }

        internal static int ParentProcessId(int pid)
        {
            try
            {
                string query = "SELECT ParentProcessId FROM Win32_Process WHERE ProcessId = " + pid.ToString();
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(query))
                using (ManagementObjectCollection results = searcher.Get())
                {
                    foreach (ManagementObject result in results)
                    {
                        int parentPid;
                        if (int.TryParse(Convert.ToString(result["ParentProcessId"]), out parentPid)) return parentPid;
                    }
                }
            }
            catch { }
            return 0;
        }

        internal static bool Matches(ProcessOwnership owner)
        {
            try
            {
                using (Process process = Process.GetProcessById(owner.ProcessId))
                {
                    if (process.HasExited) return false;
                    string path = ExecutablePath(owner.ProcessId);
                    if (string.IsNullOrEmpty(path)) return false;
                    if (!string.Equals(Path.GetFullPath(path), Path.GetFullPath(owner.ExecutablePath), StringComparison.OrdinalIgnoreCase)) return false;
                    long ticks = process.StartTime.ToUniversalTime().Ticks;
                    if (ticks != owner.StartUtcTicks) return false;
                    if (owner.ParentProcessId > 0)
                    {
                        using (Process parent = Process.GetProcessById(owner.ParentProcessId))
                        {
                            if (parent.HasExited) return false;
                            if (owner.ParentStartUtcTicks > 0 && parent.StartTime.ToUniversalTime().Ticks != owner.ParentStartUtcTicks) return false;
                        }
                    }
                    string command = CommandLine(owner.ProcessId);
                    if (!string.IsNullOrEmpty(owner.Signature) && (string.IsNullOrEmpty(command) || command.IndexOf(owner.Signature, StringComparison.OrdinalIgnoreCase) < 0)) return false;
                    if (!string.IsNullOrEmpty(owner.Profile) && (string.IsNullOrEmpty(command) || command.IndexOf(owner.Profile, StringComparison.OrdinalIgnoreCase) < 0)) return false;
                    return true;
                }
            }
            catch { return false; }
        }

        internal static List<ProcessOwnership> FindPreviewBridgeCandidates(string nodeExecutable, string entryPath)
        {
            List<ProcessOwnership> result = new List<ProcessOwnership>();
            string expectedNode;
            string expectedEntry;
            try
            {
                expectedNode = Path.GetFullPath(nodeExecutable);
                expectedEntry = Path.GetFullPath(entryPath);
            }
            catch
            {
                return result;
            }
            Process[] processes;
            try
            {
                processes = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(expectedNode));
            }
            catch
            {
                return result;
            }
            for (int i = 0; i < processes.Length; i++)
            {
                Process process = processes[i];
                try
                {
                    if (process.HasExited) continue;
                    string path = ExecutablePath(process.Id);
                    if (string.IsNullOrEmpty(path)) continue;
                    if (!string.Equals(Path.GetFullPath(path), expectedNode, StringComparison.OrdinalIgnoreCase)) continue;
                    string command = CommandLine(process.Id);
                    string normalizedCommand = string.IsNullOrEmpty(command) ? "" : command.Replace('/', '\\');
                    string normalizedEntry = expectedEntry.Replace('/', '\\');
                    if (string.IsNullOrEmpty(normalizedCommand) || normalizedCommand.IndexOf(normalizedEntry, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    result.Add(new ProcessOwnership
                    {
                        Role = "bridge",
                        ProcessId = process.Id,
                        ExecutablePath = path,
                        StartUtcTicks = process.StartTime.ToUniversalTime().Ticks,
                        Signature = expectedEntry,
                        Profile = "",
                        PidFile = "",
                        ParentProcessId = 0,
                        ParentStartUtcTicks = 0
                    });
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }
            return result;
        }

        internal static List<ProcessOwnership> FindPreviewTunnelCandidates(string tunnelExecutable, string profilePath)
        {
            List<ProcessOwnership> result = new List<ProcessOwnership>();
            string expectedExecutable;
            string expectedProfile;
            try
            {
                expectedExecutable = Path.GetFullPath(tunnelExecutable);
                expectedProfile = Path.GetFullPath(profilePath);
            }
            catch
            {
                return result;
            }
            Process[] processes;
            try
            {
                processes = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(expectedExecutable));
            }
            catch
            {
                return result;
            }
            for (int i = 0; i < processes.Length; i++)
            {
                Process process = processes[i];
                try
                {
                    if (process.HasExited) continue;
                    string path = ExecutablePath(process.Id);
                    if (string.IsNullOrEmpty(path)) continue;
                    if (!string.Equals(Path.GetFullPath(path), expectedExecutable, StringComparison.OrdinalIgnoreCase)) continue;
                    string command = CommandLine(process.Id);
                    if (string.IsNullOrEmpty(command) || command.IndexOf(expectedProfile, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    result.Add(new ProcessOwnership
                    {
                        Role = "tunnel",
                        ProcessId = process.Id,
                        ExecutablePath = path,
                        StartUtcTicks = process.StartTime.ToUniversalTime().Ticks,
                        Signature = "--config",
                        Profile = expectedProfile,
                        PidFile = "",
                        ParentProcessId = 0,
                        ParentStartUtcTicks = 0
                    });
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }
            return result;
        }

        internal static List<ProcessOwnership> FindPreviewTunnelChildCandidates(
            string nodeExecutable,
            string entryPath,
            int parentProcessId,
            long parentStartUtcTicks)
        {
            List<ProcessOwnership> result = new List<ProcessOwnership>();
            string expectedNode;
            string expectedEntry;
            try
            {
                expectedNode = Path.GetFullPath(nodeExecutable);
                expectedEntry = Path.GetFullPath(entryPath);
            }
            catch
            {
                return result;
            }
            if (parentProcessId <= 0) return result;
            Process[] processes;
            try
            {
                processes = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(expectedNode));
            }
            catch
            {
                return result;
            }
            for (int i = 0; i < processes.Length; i++)
            {
                Process process = processes[i];
                try
                {
                    if (process.HasExited) continue;
                    string path = ExecutablePath(process.Id);
                    if (string.IsNullOrEmpty(path)) continue;
                    if (!string.Equals(Path.GetFullPath(path), expectedNode, StringComparison.OrdinalIgnoreCase)) continue;
                    string command = CommandLine(process.Id);
                    string normalizedCommand = string.IsNullOrEmpty(command) ? "" : command.Replace('/', '\\');
                    string normalizedEntry = expectedEntry.Replace('/', '\\');
                    if (string.IsNullOrEmpty(normalizedCommand) || normalizedCommand.IndexOf(normalizedEntry, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (ParentProcessId(process.Id) != parentProcessId) continue;
                    if (parentStartUtcTicks > 0)
                    {
                        try
                        {
                            using (Process parent = Process.GetProcessById(parentProcessId))
                            {
                                if (parent.HasExited || parent.StartTime.ToUniversalTime().Ticks != parentStartUtcTicks) continue;
                            }
                        }
                        catch
                        {
                            continue;
                        }
                    }
                    result.Add(new ProcessOwnership
                    {
                        Role = "tunnel-mcp",
                        ProcessId = process.Id,
                        ExecutablePath = path,
                        StartUtcTicks = process.StartTime.ToUniversalTime().Ticks,
                        Signature = expectedEntry,
                        Profile = "",
                        PidFile = "",
                        ParentProcessId = parentProcessId,
                        ParentStartUtcTicks = parentStartUtcTicks
                    });
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }
            return result;
        }
    }

    internal sealed class BridgeProcessController
    {
        internal DesktopSettings Settings { get; private set; }
        internal StatusSnapshot LastSnapshot { get; private set; }
        private readonly Dictionary<string, ProcessOwnership> Ownership;
        private readonly object OwnershipLock = new object();
        private readonly object LifecycleLock = new object();
        private readonly object LogLock = new object();
        private readonly Dictionary<int, Process> MonitoredProcesses = new Dictionary<int, Process>();
        private readonly HashSet<int> ExpectedStoppingProcessIds = new HashSet<int>();
        private int TunnelRecoveryAttempts;
        private bool TunnelRecoveryRunning;
        private volatile bool Closing;
        private bool TunnelStartInProgress;

        internal BridgeProcessController(DesktopSettings settings)
        {
            Settings = settings;
            Ownership = LoadOwnership();
        }

        internal void ReloadSettings(DesktopSettings settings)
        {
            Settings = settings;
        }

        internal void Close()
        {
            lock (LifecycleLock)
            {
                Closing = true;
                Monitor.PulseAll(LifecycleLock);
            }
        }

        internal StatusSnapshot ReadStatus()
        {
            RefreshRuntimeStatusUrl();
            try
            {
                LastSnapshot = StatusSnapshot.Read(Settings.StatusUrl);
                return LastSnapshot;
            }
            catch
            {
                return null;
            }
        }

        internal DashboardViewState ReadDashboardStatus()
        {
            StatusSnapshot snapshot = ReadStatus();
            bool tunnelOwned = Owned("tunnel");
            bool bridgeOwned = Owned("bridge");
            string tunnelState = ResolveTunnelState(tunnelOwned);
            string bridgeOwnership = bridgeOwned ? "本应用管理" : (snapshot != null && snapshot.BridgeHealthy ? "外部实例" : "无可验证实例");
            string tunnelOwnership = tunnelOwned ? "本应用管理" : "外部/未运行";
            return DashboardViewState.From(snapshot, tunnelState, bridgeOwnership, tunnelOwnership);
        }

        internal string TunnelState
        {
            get
            {
                return ResolveTunnelState(Owned("tunnel"));
            }
        }

        private string ResolveTunnelState(bool tunnelOwned)
        {
            if (DesktopPaths.IsPreview)
            {
                if (tunnelOwned) return TunnelReady() ? "就绪（本应用管理）" : "错误（Tunnel/Plugin 不可用）";
                Dictionary<string, object> state = ReadTunnelState();
                string registration = StateText(state, "registration");
                if (string.Equals(registration, "failed", StringComparison.OrdinalIgnoreCase)) return "错误";
                if (string.Equals(registration, "ready", StringComparison.OrdinalIgnoreCase)) return "错误（Tunnel 已退出）";
                return Settings.StartTunnel && !File.Exists(Settings.RuntimeKeyFile) ? "未配置" : "未连接";
            }
            if (tunnelOwned) return "运行中（本应用管理）";
            if (!string.IsNullOrEmpty(Settings.TunnelReadyUrl))
            {
                if (StatusSnapshot.Probe(Settings.TunnelReadyUrl)) return "就绪（外部或 Tunnel）";
            }
            return string.IsNullOrEmpty(Settings.TunnelExecutable) ? "未配置" : "未连接";
        }

        private bool TunnelReady()
        {
            if (DesktopPaths.IsPreview)
            {
                ProcessOwnership parent = GetOwner("tunnel");
                ProcessOwnership child = GetOwner("tunnel-mcp");
                if (parent == null || child == null || !ProcessInspector.Matches(parent) || !ProcessInspector.Matches(child)) return false;
            }
            string url = ReadTunnelHealthUrl();
            return !string.IsNullOrEmpty(url) && StatusSnapshot.Probe(url.TrimEnd('/') + "/readyz");
        }

        private string ReadTunnelHealthUrl()
        {
            try
            {
                if (File.Exists(DesktopPaths.TunnelHealthUrlFile))
                {
                    string value = File.ReadAllText(DesktopPaths.TunnelHealthUrlFile, Encoding.UTF8).Trim();
                    if (!string.IsNullOrEmpty(value)) return value.TrimEnd('/');
                }
            }
            catch
            {
            }
            return Settings.TunnelReadyUrl == null ? "" : Settings.TunnelReadyUrl.TrimEnd('/');
        }

        private Dictionary<string, object> ReadTunnelState()
        {
            try
            {
                if (!File.Exists(DesktopPaths.TunnelStateFile)) return null;
                return new JavaScriptSerializer().DeserializeObject(File.ReadAllText(DesktopPaths.TunnelStateFile, Encoding.UTF8)) as Dictionary<string, object>;
            }
            catch
            {
                return null;
            }
        }

        private void RefreshRuntimeStatusUrl()
        {
            if (!DesktopPaths.IsPreview || !File.Exists(DesktopPaths.StatusUrlFile)) return;
            try
            {
                Dictionary<string, object> value = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(DesktopPaths.StatusUrlFile, Encoding.UTF8)) as Dictionary<string, object>;
                if (value == null || !string.Equals(StateText(value, "state"), "ready", StringComparison.OrdinalIgnoreCase)) return;
                Uri uri;
                string url = StateText(value, "url");
                if (!Uri.TryCreate(url, UriKind.Absolute, out uri)) return;
                if (uri.Scheme != Uri.UriSchemeHttp || (uri.Host != "127.0.0.1" && uri.Host != "localhost") || uri.Port < 1 || uri.Port > 65535) return;
                Settings.StatusUrl = uri.ToString();
            }
            catch
            {
            }
        }

        private ProcessOwnership GetOwner(string role)
        {
            lock (OwnershipLock)
            {
                ProcessOwnership owner;
                return Ownership.TryGetValue(role, out owner) ? owner : null;
            }
        }

        private void MonitorOwnedProcess(string role, Process process)
        {
            if (process == null) return;
            try
            {
                process.EnableRaisingEvents = true;
                process.Exited += delegate(object sender, EventArgs args) { HandleOwnedProcessExited(role, process); };
                lock (LifecycleLock)
                {
                    Process previous;
                    if (MonitoredProcesses.TryGetValue(process.Id, out previous) && !object.ReferenceEquals(previous, process))
                    {
                        try { previous.Dispose(); } catch { }
                    }
                    MonitoredProcesses[process.Id] = process;
                }
                if (process.HasExited) HandleOwnedProcessExited(role, process);
            }
            catch
            {
            }
        }

        private void ReleaseMonitoredProcess(int processId)
        {
            Process process = null;
            lock (LifecycleLock)
            {
                if (MonitoredProcesses.TryGetValue(processId, out process)) MonitoredProcesses.Remove(processId);
            }
            if (process != null)
            {
                // Process.Exited callbacks can still be unwinding while the
                // controller is holding LifecycleLock during an exact stop.
                // Dispose the managed watcher off-lock so shutdown cannot
                // wait on the callback/handle cleanup path.  This does not
                // affect the already-confirmed OS process termination.
                ThreadPool.QueueUserWorkItem(delegate(object state)
                {
                    try { process.Dispose(); } catch { }
                });
            }
        }

        private void MonitorRecordedOwner(string role, ProcessOwnership owner)
        {
            if (owner == null) return;
            try
            {
                Process process = Process.GetProcessById(owner.ProcessId);
                MonitorOwnedProcess(role, process);
            }
            catch
            {
            }
        }

        private void HandleOwnedProcessExited(string role, Process process)
        {
            if (process == null) return;
            lock (LifecycleLock)
            {
                ProcessOwnership owner = GetOwner(role);
                if (owner == null || owner.ProcessId != process.Id) return;
                bool expected = ExpectedStoppingProcessIds.Contains(process.Id);
                int parentPid = 0;
                if (string.Equals(role, "tunnel-mcp", StringComparison.OrdinalIgnoreCase))
                {
                    ProcessOwnership parent = GetOwner("tunnel");
                    parentPid = parent == null ? 0 : parent.ProcessId;
                }
                Ownership.Remove(role);
                if (string.Equals(role, "tunnel", StringComparison.OrdinalIgnoreCase)) Ownership.Remove("tunnel-mcp");
                SaveOwnership();
                if (DesktopPaths.IsPreview && !expected)
                {
                    string reason = string.Equals(role, "tunnel-mcp", StringComparison.OrdinalIgnoreCase)
                        ? "mcp_stdio_child_exited"
                        : "tunnel_process_exited";
                    WriteTunnelState("error", "failed", "", reason, parentPid);
                    QueueTunnelRecovery();
                }
            }
            ReleaseMonitoredProcess(process.Id);
        }

        private void QueueTunnelRecovery()
        {
            if (!DesktopPaths.IsPreview || !Settings.StartTunnel || Closing || TunnelRecoveryRunning) return;
            TunnelRecoveryRunning = true;
            ThreadPool.QueueUserWorkItem(delegate(object state) { RecoverTunnel(); });
        }

        private void RecoverTunnel()
        {
            try
            {
                for (int attempt = 1; attempt <= 3; attempt++)
                {
                    if (Closing) return;
                    TunnelRecoveryAttempts = attempt;
                    Thread.Sleep(250 * attempt);
                    bool shouldStart = false;
                    lock (LifecycleLock)
                    {
                        if (Closing) return;
                        if (TunnelReady())
                        {
                            TunnelRecoveryAttempts = 0;
                            return;
                        }
                        if (Owned("tunnel"))
                        {
                            List<string> failures = new List<string>();
                            StopRole("tunnel", failures);
                            if (failures.Count > 0) continue;
                        }
                        shouldStart = !Owned("tunnel");
                    }
                    if (shouldStart && !Closing)
                    {
                        try { StartTunnelForRecovery(); } catch { }
                    }
                    lock (LifecycleLock)
                    {
                        if (Closing) return;
                        if (TunnelReady())
                        {
                            TunnelRecoveryAttempts = 0;
                            return;
                        }
                    }
                }
                WriteTunnelState("error", "failed", "", "tunnel_recovery_exhausted", 0);
            }
            finally
            {
                TunnelRecoveryRunning = false;
            }
        }

        private static string StateText(Dictionary<string, object> state, string key)
        {
            object value;
            return state != null && state.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
        }

        internal string TunnelId
        {
            get
            {
                Dictionary<string, object> state = ReadTunnelState();
                string value = StateText(state, "tunnel_id");
                return string.IsNullOrEmpty(value) ? Settings.TunnelId : value;
            }
        }

        internal string TunnelRegistration
        {
            get
            {
                string value = StateText(ReadTunnelState(), "registration");
                return string.IsNullOrEmpty(value) ? (Settings.StartTunnel ? "registering" : "not_registered") : value;
            }
        }

        internal string TunnelClientVersion
        {
            get
            {
                string value = StateText(ReadTunnelState(), "client_version");
                return string.IsNullOrEmpty(value) ? Settings.TunnelClientVersion : value;
            }
        }

        internal string TunnelLastError
        {
            get { return StateText(ReadTunnelState(), "last_error"); }
        }

        internal string BridgeOwnership
        {
            get { return Owned("bridge") ? "本应用管理" : (LastSnapshot != null && LastSnapshot.BridgeHealthy ? "外部实例" : "无可验证实例"); }
        }

        internal string TunnelOwnership
        {
            get { return Owned("tunnel") ? "本应用管理" : "外部/未运行"; }
        }

        internal string Start()
        {
            lock (LifecycleLock)
            {
                bool bridgeKnown = false;
                bool tunnelKnown = false;
                if (DesktopPaths.IsPreview)
                {
                    bridgeKnown = ReconcilePreviewBridgeOwnership();
                    tunnelKnown = ReconcilePreviewTunnelOwnership();
                    if (PortInUse(Settings.StatusUrl) && !bridgeKnown) return "Bridge status port 已被占用，未启动。";
                }
                StatusSnapshot existing = ReadStatus();
                if (existing != null && existing.BridgeHealthy)
                {
                    if (DesktopPaths.IsPreview && Settings.StartTunnel && !tunnelKnown)
                    {
                        if (Owned("tunnel"))
                        {
                            List<string> failures = new List<string>();
                            StopRole("tunnel", failures);
                            if (failures.Count > 0) return "Tunnel 状态异常，未能安全回收：" + string.Join("、", failures.ToArray());
                        }
                        if (!Owned("tunnel")) StartTunnel();
                    }
                    return "已复用健康 Bridge；未重复启动。";
                }
                if (PortInUse(Settings.StatusUrl) && !bridgeKnown) return "端口冲突：状态端口已被非 Bridge 进程占用，未启动。";
                if (Settings.LaunchBridgeDirectly && !Owned("bridge")) StartBridge();
                if (Settings.StartTunnel)
                {
                    if (DesktopPaths.IsPreview && !tunnelKnown && Owned("tunnel"))
                    {
                        List<string> failures = new List<string>();
                        StopRole("tunnel", failures);
                        if (failures.Count > 0) return "Tunnel 状态异常，未能安全回收：" + string.Join("、", failures.ToArray());
                    }
                    if (!Owned("tunnel")) StartTunnel();
                }
                return "已请求后台启动；等待状态页就绪。";
            }
        }

        internal string Stop()
        {
            WriteLog("lifecycle", "stop-enter");
            lock (LifecycleLock)
            {
                WriteLog("lifecycle", "stop-lock-acquired");
                DateTime tunnelStartDeadline = DateTime.UtcNow.AddSeconds(5);
                while (TunnelStartInProgress)
                {
                    TimeSpan remaining = tunnelStartDeadline - DateTime.UtcNow;
                    if (remaining <= TimeSpan.Zero) break;
                    int waitMilliseconds = (int)Math.Min(1000, Math.Max(1, remaining.TotalMilliseconds));
                    try { Monitor.Wait(LifecycleLock, waitMilliseconds); } catch (SynchronizationLockException) { break; }
                }
                WriteLog("lifecycle", "stop-after-tunnel-start-wait");
                List<string> failures = new List<string>();
                if (TunnelStartInProgress) failures.Add("tunnel（启动状态无法在时限内结束）");
                if (DesktopPaths.IsPreview)
                {
                    WriteLog("lifecycle", "stop-role-tunnel-enter");
                    StopRole("tunnel", failures);
                    WriteLog("lifecycle", "stop-role-tunnel-exit");
                    WriteLog("lifecycle", "stop-role-bridge-enter");
                    StopRole("bridge", failures);
                    WriteLog("lifecycle", "stop-role-bridge-exit");
                    RemoveStalePreviewBridgeOwnership();
                    RemoveStalePreviewTunnelOwnership();
                }
                else
                {
                    WriteLog("lifecycle", "stop-role-tunnel-enter");
                    StopRole("tunnel", failures);
                    WriteLog("lifecycle", "stop-role-tunnel-exit");
                    WriteLog("lifecycle", "stop-role-bridge-enter");
                    StopRole("bridge", failures);
                    WriteLog("lifecycle", "stop-role-bridge-exit");
                }
                WriteLog("lifecycle", "stop-before-return");
                if (failures.Count > 0) return "未停止外部或身份无法重新核验的实例：" + string.Join("、", failures.ToArray());
                return "已停止本应用确认拥有的进程。";
            }
        }

        internal string Restart()
        {
            string stop = Stop();
            if (stop.IndexOf("未停止外部", StringComparison.OrdinalIgnoreCase) >= 0) return stop;
            Thread.Sleep(350);
            return Start();
        }

        internal string Diagnostics()
        {
            StatusSnapshot snapshot = LastSnapshot ?? ReadStatus();
            if (snapshot == null) return "Bridge 状态不可用；未复制任何密钥或命令行信息。";
            return snapshot.SafeDiagnostics(TunnelState, BridgeOwnership, TunnelOwnership);
        }

        internal void OpenLogs()
        {
            Directory.CreateDirectory(Settings.LogDirectory);
            Process.Start(new ProcessStartInfo("explorer.exe", Quote(Settings.LogDirectory)) { UseShellExecute = false, CreateNoWindow = true });
        }

        internal bool Owned(string role)
        {
            ProcessOwnership owner;
            lock (OwnershipLock)
            {
                if (!Ownership.TryGetValue(role, out owner)) return false;
            }
            return ProcessInspector.Matches(owner);
        }

        private bool ReconcilePreviewBridgeOwnership()
        {
            if (!DesktopPaths.IsPreview) return false;
            ProcessOwnership recorded = null;
            lock (OwnershipLock) Ownership.TryGetValue("bridge", out recorded);
            if (recorded != null && ProcessInspector.Matches(recorded))
            {
                MonitorRecordedOwner("bridge", recorded);
                return true;
            }
            bool changed = false;
            if (recorded != null)
            {
                lock (OwnershipLock) changed = Ownership.Remove("bridge");
            }
            if (!PortInUse(Settings.StatusUrl))
            {
                if (changed) SaveOwnership();
                return false;
            }
            StatusSnapshot existing = ReadStatus();
            if (existing == null || !existing.BridgeHealthy)
            {
                if (changed) SaveOwnership();
                return false;
            }
            List<ProcessOwnership> candidates = ProcessInspector.FindPreviewBridgeCandidates(Settings.NodeExecutable, Settings.GetBridgeEntryPath());
            if (candidates.Count == 1)
            {
                lock (OwnershipLock) Ownership["bridge"] = candidates[0];
                SaveOwnership();
                MonitorRecordedOwner("bridge", candidates[0]);
                return true;
            }
            if (changed) SaveOwnership();
            return false;
        }

        private bool ReconcilePreviewTunnelOwnership()
        {
            if (!DesktopPaths.IsPreview || !Settings.StartTunnel) return false;
            ProcessOwnership recorded = GetOwner("tunnel");
            if (recorded == null || !ProcessInspector.Matches(recorded))
            {
                bool changed = false;
                lock (OwnershipLock)
                {
                    changed = Ownership.Remove("tunnel") | Ownership.Remove("tunnel-mcp");
                }
                if (changed) SaveOwnership();
                WriteTunnelState("stopped", "not_registered", "", "stale_tunnel_ownership", 0);
                recorded = null;
                List<ProcessOwnership> candidates = ProcessInspector.FindPreviewTunnelCandidates(
                    Settings.TunnelExecutable,
                    DesktopPaths.TunnelProfileFile);
                if (candidates.Count == 1)
                {
                    recorded = candidates[0];
                    lock (OwnershipLock) Ownership["tunnel"] = recorded;
                    SaveOwnership();
                }
            }
            if (recorded == null) return false;
            MonitorRecordedOwner("tunnel", recorded);

            ProcessOwnership child = GetOwner("tunnel-mcp");
            if (child == null || !ProcessInspector.Matches(child))
            {
                List<ProcessOwnership> children = ProcessInspector.FindPreviewTunnelChildCandidates(
                    Settings.NodeExecutable,
                    Settings.GetBridgeEntryPath(),
                    recorded.ProcessId,
                    recorded.StartUtcTicks);
                if (children.Count != 1)
                {
                    lock (OwnershipLock) Ownership.Remove("tunnel-mcp");
                    SaveOwnership();
                    WriteTunnelState("error", "failed", "", "mcp_stdio_child_not_found", recorded.ProcessId);
                    return false;
                }
                child = children[0];
                lock (OwnershipLock) Ownership["tunnel-mcp"] = child;
                SaveOwnership();
            }
            MonitorRecordedOwner("tunnel-mcp", child);
            string registration = StateText(ReadTunnelState(), "registration");
            if (string.Equals(registration, "ready", StringComparison.OrdinalIgnoreCase) && !TunnelReady())
            {
                WriteTunnelState("error", "failed", "", "tunnel_health_probe_failed", recorded.ProcessId);
                return false;
            }
            return true;
        }

        private void RemoveStalePreviewBridgeOwnership()
        {
            if (!DesktopPaths.IsPreview) return;
            ProcessOwnership owner = null;
            lock (OwnershipLock) Ownership.TryGetValue("bridge", out owner);
            if (owner != null && !ProcessInspector.Matches(owner))
            {
                lock (OwnershipLock) Ownership.Remove("bridge");
                SaveOwnership();
            }
        }

        private void RemoveStalePreviewTunnelOwnership()
        {
            if (!DesktopPaths.IsPreview) return;
            ProcessOwnership owner = GetOwner("tunnel");
            ProcessOwnership child = GetOwner("tunnel-mcp");
            if ((owner != null && !ProcessInspector.Matches(owner)) || (child != null && !ProcessInspector.Matches(child)))
            {
                lock (OwnershipLock)
                {
                    Ownership.Remove("tunnel");
                    Ownership.Remove("tunnel-mcp");
                }
                SaveOwnership();
                WriteTunnelState("stopped", "not_registered", "", "stale_tunnel_ownership", 0);
            }
        }

        private void StartBridge()
        {
            if (!File.Exists(Settings.NodeExecutable)) throw new InvalidOperationException("未找到 Node.js：请在首次运行向导中配置。\n" + Settings.NodeExecutable);
            if (!File.Exists(Settings.GetBridgeEntryPath())) throw new InvalidOperationException("未找到 Bridge 构建入口：" + Settings.GetBridgeEntryPath());
            Directory.CreateDirectory(Settings.LogDirectory);
            ProcessStartInfo start = new ProcessStartInfo(Settings.NodeExecutable, Quote(Settings.GetBridgeEntryPath()));
            start.WorkingDirectory = Settings.BridgeWorkingDirectory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.EnvironmentVariables["CODEX_EXE"] = Settings.CodexExecutable;
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_SERVICE_SESSIONS_FILE"] = Settings.ServiceSessionFile;
            string statusPort = Port(Settings.StatusUrl);
            if (DesktopPaths.IsPreview)
            {
                // Production Preview lets Node bind atomically to port 0 and
                // publish the actual lease. Isolated host tests retain their
                // deterministic 37930-37939 port contract.
                if (!DesktopPaths.IsTestStateRoot) statusPort = "0";
                DeleteFile(DesktopPaths.StatusUrlFile);
                start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_STATUS_URL_FILE"] = DesktopPaths.StatusUrlFile;
            }
            if (!string.IsNullOrEmpty(statusPort)) start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_STATUS_PORT"] = statusPort;
            if (DesktopPaths.IsPreview)
            {
                start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_STATUS_FILE"] = Path.Combine(DesktopPaths.Root, "task_status.json");
                start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_TASKS_FILE"] = Path.Combine(DesktopPaths.Root, "task_records.json");
                start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_CHECKPOINT_DIR"] = Path.Combine(DesktopPaths.Root, "checkpoints");
                start.EnvironmentVariables["LUMEN_CODEX_V2_CHECKPOINT_DIR"] = Path.Combine(DesktopPaths.Root, "checkpoints");
                start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_UX_PROJECTION"] = Path.Combine(DesktopPaths.Root, "ux-projection.json");
                start.EnvironmentVariables["LUMEN_CODEX_V2_UX_PROJECTION"] = Path.Combine(DesktopPaths.Root, "ux-projection.json");
                start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_TUNNEL_ID"] = Settings.TunnelId ?? "";
                start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_TUNNEL_STATE_FILE"] = DesktopPaths.TunnelStateFile;
                start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_TUNNEL_HEALTH_URL_FILE"] = DesktopPaths.TunnelHealthUrlFile;
            }
            Process process = Process.Start(start);
            process.BeginOutputReadLine();
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) WriteLog("bridge", e.Data); };
            process.BeginErrorReadLine();
            SaveOwner("bridge", process, "index.js", "", "");
            MonitorOwnedProcess("bridge", process);
        }

        private void StartTunnel()
        {
            if (Closing) throw new InvalidOperationException("Bridge process controller is closing.");
            if (DesktopPaths.IsPreview)
            {
                try { StartPreviewTunnel(); }
                catch (Exception error)
                {
                    // Includes pre-spawn configuration/credential failures,
                    // not only errors inside WaitForPreviewTunnelReady.
                    WriteTunnelState("error", "failed", "", error.Message, 0);
                    WriteLog("tunnel", "startup failed: " + error.Message);
                    throw;
                }
                return;
            }
            if (!File.Exists(Settings.TunnelExecutable)) throw new InvalidOperationException("未找到 Tunnel client：请在首次运行向导中配置。\n" + Settings.TunnelExecutable);
            if (string.IsNullOrEmpty(Settings.TunnelProfile)) throw new InvalidOperationException("Tunnel profile 未配置；不会猜测或使用其他 profile。");
            string key = SecureStore.Read(Settings.RuntimeKeyFile);
            Directory.CreateDirectory(Settings.LogDirectory);
            string pidFile = Path.Combine(DesktopPaths.RunDirectory, "tunnel-" + Guid.NewGuid().ToString("N") + ".pid");
            string logFile = Path.Combine(Settings.LogDirectory, "tunnel-client.log");
            ProcessStartInfo start = new ProcessStartInfo(Settings.TunnelExecutable, "run --profile " + Quote(Settings.TunnelProfile) + " --pid.file " + Quote(pidFile) + " --log.file " + Quote(logFile));
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.EnvironmentVariables["CONTROL_PLANE_API_KEY"] = key;
            Process process = Process.Start(start);
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) WriteLog("tunnel", e.Data); };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) WriteLog("tunnel", e.Data); };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            SaveOwner("tunnel", process, "--profile", Settings.TunnelProfile, pidFile);
            MonitorOwnedProcess("tunnel", process);
            key = null;
        }

        private void StartTunnelForRecovery()
        {
            lock (LifecycleLock)
            {
                if (Closing) return;
                TunnelStartInProgress = true;
            }
            try
            {
                StartTunnel();
            }
            finally
            {
                lock (LifecycleLock)
                {
                    TunnelStartInProgress = false;
                    Monitor.PulseAll(LifecycleLock);
                }
            }
        }

        private void StartPreviewTunnel()
        {
            string client = Settings.TunnelExecutable;
            string entry = Settings.GetBridgeEntryPath();
            string tunnelId = V6TunnelProfile.ReadTunnelId();
            if (!File.Exists(client)) throw new InvalidOperationException("未找到包内 V6 Tunnel client：" + client);
            if (!File.Exists(V6TunnelProfile.TemplatePath())) throw new InvalidOperationException("未找到包内 V6 Tunnel profile 模板。");
            if (!File.Exists(Settings.RuntimeKeyFile)) throw new InvalidOperationException("V6 Tunnel 尚未配置 Runtime API Key。");
            if (string.IsNullOrEmpty(tunnelId)) throw new InvalidOperationException("V6 Tunnel profile 缺少有效 tunnel ID。");
            V6TunnelProfile.WriteRuntimeProfile(DesktopPaths.TunnelProfileFile, entry, Settings.NodeExecutable);
            Settings.TunnelExecutable = client;
            Settings.TunnelProfile = "local-codex-bridge-v6";
            Settings.TunnelId = tunnelId;
            Settings.TunnelClientVersion = V6TunnelProfile.ReadClientVersion();
            Settings.TunnelHealthUrlFile = DesktopPaths.TunnelHealthUrlFile;
            DeleteFile(DesktopPaths.TunnelHealthUrlFile);
            WriteTunnelState("starting", "registering", "", "", 0);
            string tunnelRoot = Path.Combine(DesktopPaths.Root, "tunnel-bridge");
            Directory.CreateDirectory(tunnelRoot);
            int statusPort = FindPreviewTunnelStatusPort();
            string pidFile = Path.Combine(DesktopPaths.RunDirectory, "tunnel-client.pid");
            string logFile = Path.Combine(Settings.LogDirectory, "tunnel-client.log");
            DeleteFile(pidFile);
            ProcessStartInfo start = new ProcessStartInfo(client,
                "run --config " + Quote(DesktopPaths.TunnelProfileFile)
                + " --control-plane.api-key env:CONTROL_PLANE_API_KEY"
                + " --health.listen-addr 127.0.0.1:0"
                + " --health.url-file " + Quote(DesktopPaths.TunnelHealthUrlFile)
                + " --pid.file " + Quote(pidFile)
                + " --log.file " + Quote(logFile)
                + " --log.format json");
            start.WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.EnvironmentVariables["CONTROL_PLANE_API_KEY"] = SecureStore.Read(Settings.RuntimeKeyFile);
            start.EnvironmentVariables["CONTROL_PLANE_TUNNEL_ID"] = tunnelId;
            start.EnvironmentVariables["CODEX_EXE"] = Settings.CodexExecutable;
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_STATUS_PORT"] = statusPort.ToString();
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_STATUS_FILE"] = Path.Combine(tunnelRoot, "task_status.json");
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_TASKS_FILE"] = Path.Combine(tunnelRoot, "task_records.json");
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_SERVICE_SESSIONS_FILE"] = Path.Combine(tunnelRoot, "service_sessions.json");
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_CHECKPOINT_DIR"] = Path.Combine(tunnelRoot, "checkpoints");
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_UX_PROJECTION"] = Path.Combine(tunnelRoot, "ux-projection.json");
            start.EnvironmentVariables["LUMEN_CODEX_V2_UX_PROJECTION"] = Path.Combine(tunnelRoot, "ux-projection.json");
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_TUNNEL_ID"] = tunnelId;
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_TUNNEL_STATE_FILE"] = DesktopPaths.TunnelStateFile;
            start.EnvironmentVariables["LOCAL_CODEX_BRIDGE_TUNNEL_HEALTH_URL_FILE"] = DesktopPaths.TunnelHealthUrlFile;
            Process process = Process.Start(start);
            if (process == null) throw new InvalidOperationException("无法启动 V6 Tunnel client。");
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) WriteLog("tunnel", e.Data); };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) WriteLog("tunnel", e.Data); };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            SaveOwner("tunnel", process, "--config", DesktopPaths.TunnelProfileFile, pidFile);
            MonitorOwnedProcess("tunnel", process);
            try
            {
                WaitForPreviewTunnelReady(process);
            }
            catch (Exception error)
            {
                WriteTunnelState("error", "failed", "", error.Message, 0);
                List<string> ignored = new List<string>();
                StopRole("tunnel", ignored);
                throw;
            }
        }

        private void WaitForPreviewTunnelReady(Process process)
        {
            for (int attempt = 0; attempt < 80; attempt++)
            {
                if (Closing) throw new InvalidOperationException("Bridge process controller is closing.");
                if (process.HasExited) throw new InvalidOperationException("V6 Tunnel client 在注册前退出，exit code=" + process.ExitCode.ToString());
                string url = ReadTunnelHealthUrl();
                if (!string.IsNullOrEmpty(url) && StatusSnapshot.Probe(url + "/readyz"))
                {
                    if (!CapturePreviewTunnelChildOwner(process))
                    {
                        throw new InvalidOperationException("V6 Tunnel MCP stdio child identity was not verified.");
                    }
                    Settings.TunnelReadyUrl = url;
                    WriteTunnelState("running", "ready", url, "", process.Id);
                    return;
                }
                Thread.Sleep(250);
            }
            throw new InvalidOperationException("V6 Tunnel client 未在超时前报告 ready。");
        }

        private bool CapturePreviewTunnelChildOwner(Process tunnelProcess)
        {
            if (tunnelProcess == null || tunnelProcess.HasExited) return false;
            List<ProcessOwnership> children = ProcessInspector.FindPreviewTunnelChildCandidates(
                Settings.NodeExecutable,
                Settings.GetBridgeEntryPath(),
                tunnelProcess.Id,
                tunnelProcess.StartTime.ToUniversalTime().Ticks);
            if (children.Count != 1) return false;
            ProcessOwnership child = children[0];
            lock (OwnershipLock) Ownership["tunnel-mcp"] = child;
            SaveOwnership();
            MonitorRecordedOwner("tunnel-mcp", child);
            return true;
        }

        private int FindPreviewTunnelStatusPort()
        {
            int bridgePort;
            int.TryParse(Port(Settings.StatusUrl), out bridgePort);
            for (int port = 37930; port <= 37939; port++)
            {
                if (port == bridgePort) continue;
                if (PreviewPortAllocator.IsAvailable(port)) return port;
            }
            throw new InvalidOperationException("Local Codex Bridge 没有可用的 V6 Tunnel MCP status port。");
        }

        private void WriteTunnelState(string status, string registration, string healthUrl, string error, int processId)
        {
            try
            {
                ProcessOwnership parent = GetOwner("tunnel");
                ProcessOwnership child = GetOwner("tunnel-mcp");
                int effectiveProcessId = processId > 0 ? processId : (parent == null ? 0 : parent.ProcessId);
                Dictionary<string, object> value = new Dictionary<string, object>();
                value["schemaVersion"] = 1;
                value["status"] = status ?? "";
                value["registration"] = registration ?? "";
                value["tunnel_id"] = Settings.TunnelId ?? "";
                value["client_version"] = Settings.TunnelClientVersion ?? "";
                value["health_url"] = healthUrl ?? "";
                value["process_id"] = effectiveProcessId;
                value["parent_pid"] = effectiveProcessId;
                value["parent_start_utc_ticks"] = parent == null ? 0 : parent.StartUtcTicks;
                value["mcp_child_pid"] = child == null ? 0 : child.ProcessId;
                value["mcp_child_start_utc_ticks"] = child == null ? 0 : child.StartUtcTicks;
                value["mcp_child_executable_path"] = child == null ? "" : child.ExecutablePath;
                value["mcp_child_command_line_fingerprint"] = child == null ? "" : child.Signature;
                value["transport_status"] = string.Equals(status, "running", StringComparison.OrdinalIgnoreCase)
                    && string.Equals(registration, "ready", StringComparison.OrdinalIgnoreCase) ? "ready" : (string.Equals(status, "error", StringComparison.OrdinalIgnoreCase) ? "failed" : "unknown");
                value["transport_last_error"] = error ?? "";
                value["health_probe"] = string.Equals(status, "running", StringComparison.OrdinalIgnoreCase)
                    && string.Equals(registration, "ready", StringComparison.OrdinalIgnoreCase) ? "ok" : (string.Equals(status, "error", StringComparison.OrdinalIgnoreCase) ? "failed" : "unknown");
                value["restart_attempt"] = TunnelRecoveryAttempts;
                value["last_initialize_at"] = "";
                value["last_tools_list_at"] = "";
                value["last_disconnect_reason"] = error ?? "";
                value["last_error"] = error ?? "";
                value["updated_at"] = DateTime.UtcNow.ToString("o");
                Directory.CreateDirectory(DesktopPaths.RunDirectory);
                string temporary = DesktopPaths.TunnelStateFile + "." + Process.GetCurrentProcess().Id.ToString() + ".tmp";
                File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(value) + Environment.NewLine, new UTF8Encoding(false));
                if (File.Exists(DesktopPaths.TunnelStateFile)) File.Replace(temporary, DesktopPaths.TunnelStateFile, null, true);
                else File.Move(temporary, DesktopPaths.TunnelStateFile);
            }
            catch
            {
            }
        }

        private static void DeleteFile(string path)
        {
            try { if (!string.IsNullOrEmpty(path) && File.Exists(path)) File.Delete(path); } catch { }
        }

        private void StopRole(string role, List<string> failures)
        {
            WriteLog("lifecycle", "stop-role-start " + role);
            ProcessOwnership owner = GetOwner(role);
            if (owner == null) { WriteLog("lifecycle", "stop-role-no-owner " + role); return; }
            ProcessOwnership child = string.Equals(role, "tunnel", StringComparison.OrdinalIgnoreCase) ? GetOwner("tunnel-mcp") : null;
            WriteLog("lifecycle", "stop-role-before-match " + role + " pid=" + owner.ProcessId.ToString());
            if (!ProcessInspector.Matches(owner))
            {
                WriteLog("lifecycle", "stop-role-mismatch " + role);
                failures.Add(role + "（ownership mismatch）");
                return;
            }
            WriteLog("lifecycle", "stop-role-match " + role);
            lock (LifecycleLock)
            {
                ExpectedStoppingProcessIds.Add(owner.ProcessId);
                if (child != null) ExpectedStoppingProcessIds.Add(child.ProcessId);
            }
            try
            {
                WriteLog("lifecycle", "stop-role-taskkill-start " + role);
                ProcessStartInfo start = new ProcessStartInfo("taskkill.exe", "/PID " + owner.ProcessId.ToString() + " /T /F");
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                using (Process killer = Process.Start(start)) killer.WaitForExit(10000);
                WriteLog("lifecycle", "stop-role-taskkill-exit " + role);
            }
            catch
            {
                lock (LifecycleLock)
                {
                    ExpectedStoppingProcessIds.Remove(owner.ProcessId);
                    if (child != null) ExpectedStoppingProcessIds.Remove(child.ProcessId);
                }
                failures.Add(role + "（停止命令失败）");
                WriteLog("lifecycle", "stop-role-taskkill-failed " + role);
                return;
            }
            WriteLog("lifecycle", "stop-role-before-confirm " + role);
            bool stopped = false;
            try
            {
                using (Process remaining = Process.GetProcessById(owner.ProcessId)) stopped = remaining.HasExited;
            }
            catch
            {
                stopped = true;
            }
            if (!stopped)
            {
                lock (LifecycleLock)
                {
                    ExpectedStoppingProcessIds.Remove(owner.ProcessId);
                    if (child != null) ExpectedStoppingProcessIds.Remove(child.ProcessId);
                }
                failures.Add(role + "（停止未确认）");
                WriteLog("lifecycle", "stop-role-not-confirmed " + role);
                return;
            }
            WriteLog("lifecycle", "stop-role-confirmed " + role);
            lock (OwnershipLock)
            {
                Ownership.Remove(role);
                if (string.Equals(role, "tunnel", StringComparison.OrdinalIgnoreCase)) Ownership.Remove("tunnel-mcp");
            }
            SaveOwnership();
            WriteLog("lifecycle", "stop-role-after-save-owner " + role);
            ReleaseMonitoredProcess(owner.ProcessId);
            WriteLog("lifecycle", "stop-role-after-release-owner " + role);
            if (child != null) ReleaseMonitoredProcess(child.ProcessId);
            WriteLog("lifecycle", "stop-role-after-release-child " + role);
            lock (LifecycleLock)
            {
                ExpectedStoppingProcessIds.Remove(owner.ProcessId);
                if (child != null) ExpectedStoppingProcessIds.Remove(child.ProcessId);
            }
            WriteLog("lifecycle", "stop-role-after-expected-clear " + role);
            if (DesktopPaths.IsPreview && string.Equals(role, "tunnel", StringComparison.OrdinalIgnoreCase))
            {
                DeleteFile(DesktopPaths.TunnelHealthUrlFile);
                DeleteFile(Path.Combine(DesktopPaths.RunDirectory, "tunnel-client.pid"));
                WriteTunnelState("stopped", "not_registered", "", "", 0);
                WriteLog("lifecycle", "stop-role-after-state-write " + role);
            }
            WriteLog("lifecycle", "stop-role-finished " + role);
        }

        private void SaveOwner(string role, Process process, string signature, string profile, string pidFile)
        {
            string executablePath = role == "tunnel" ? Settings.TunnelExecutable : Settings.NodeExecutable;
            try { executablePath = Path.GetFullPath(executablePath); } catch { }
            ProcessOwnership owner = new ProcessOwnership
            {
                Role = role,
                ProcessId = process.Id,
                ExecutablePath = executablePath,
                StartUtcTicks = process.StartTime.ToUniversalTime().Ticks,
                Signature = signature,
                Profile = profile,
                PidFile = pidFile
            };
            lock (OwnershipLock) Ownership[role] = owner;
            SaveOwnership();
        }

        private Dictionary<string, ProcessOwnership> LoadOwnership()
        {
            Dictionary<string, ProcessOwnership> result = new Dictionary<string, ProcessOwnership>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (!File.Exists(DesktopPaths.OwnershipFile)) return result;
                object parsed = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(DesktopPaths.OwnershipFile, Encoding.UTF8));
                Dictionary<string, object> root = parsed as Dictionary<string, object>;
                if (root == null) return result;
                foreach (KeyValuePair<string, object> pair in root)
                {
                    ProcessOwnership owner = ProcessOwnership.FromDictionary(pair.Value as Dictionary<string, object>);
                    if (owner != null) result[pair.Key] = owner;
                }
            }
            catch { }
            return result;
        }

        private void SaveOwnership()
        {
            try
            {
                DesktopPaths.EnsureDirectories();
                Dictionary<string, object> root = new Dictionary<string, object>();
                lock (OwnershipLock)
                {
                    foreach (KeyValuePair<string, ProcessOwnership> pair in Ownership) root[pair.Key] = pair.Value.ToDictionary();
                }
                File.WriteAllText(DesktopPaths.OwnershipFile, new JavaScriptSerializer().Serialize(root) + Environment.NewLine, new UTF8Encoding(false));
            }
            catch { }
        }

        private void WriteLog(string role, string message)
        {
            try
            {
                Directory.CreateDirectory(Settings.LogDirectory);
                string path = Path.Combine(Settings.LogDirectory, role + ".log");
                lock (LogLock) File.AppendAllText(path, DateTime.Now.ToString("s") + " " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        private static bool PortInUse(string url)
        {
            int port;
            if (!int.TryParse(Port(url), out port)) return false;
            try
            {
                IPGlobalProperties properties = IPGlobalProperties.GetIPGlobalProperties();
                IPEndPoint[] endpoints = properties.GetActiveTcpListeners();
                for (int i = 0; i < endpoints.Length; i++) if (endpoints[i].Port == port) return true;
            }
            catch { }
            return false;
        }

        private static string Port(string url)
        {
            Uri uri;
            return Uri.TryCreate(url, UriKind.Absolute, out uri) ? uri.Port.ToString() : "";
        }

        private static string Quote(string value)
        {
            return "\"" + (value ?? "").Replace("\"", "\\\"") + "\"";
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly DesktopSettings Settings;
        private readonly TextBox NodeBox;
        private readonly TextBox CodexBox;
        private readonly TextBox RootBox;
        private readonly TextBox StatusBox;
        private readonly TextBox TunnelBox;
        private readonly TextBox ProfileBox;
        private readonly TextBox TunnelIdBox;
        private readonly TextBox KeyBox;
        private readonly CheckBox DirectBridgeBox;
        private readonly CheckBox TunnelBoxCheck;
        private readonly CheckBox StartupBox;
        internal bool Saved { get; private set; }

        internal SetupForm(DesktopSettings settings)
        {
            Settings = settings;
            Text = DesktopPaths.ProductName + " 首次运行配置";
            StartPosition = FormStartPosition.CenterScreen;
            Width = 720;
            Height = 620;
            MinimumSize = new Size(680, 500);
            Font = new Font("Segoe UI", 9F);

            TableLayoutPanel table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 13, Padding = new Padding(18), AutoScroll = true };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170F));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            Controls.Add(table);
            Label intro = new Label { Text = "配置只保存路径、端口和开关。Runtime API Key 使用当前 Windows 用户 DPAPI 加密保存，不会写入 Git、日志或命令行。Local Codex Bridge 会自动使用独立 Service Codex 线程。", Dock = DockStyle.Fill, AutoSize = false, Height = 64 };
            table.Controls.Add(intro, 0, 0); table.SetColumnSpan(intro, 2);
            NodeBox = AddField(table, 1, "Node.js 可执行文件", settings.NodeExecutable);
            CodexBox = AddField(table, 2, "官方 Codex CLI", settings.CodexExecutable);
            RootBox = AddField(table, 3, "Bridge 工作目录", settings.BridgeWorkingDirectory);
            StatusBox = AddField(table, 4, "状态 API（仅 loopback）", settings.StatusUrl);
            TunnelBox = AddField(table, 5, "Tunnel client（可选）", settings.TunnelExecutable);
            ProfileBox = AddField(table, 6, "Tunnel profile（可选）", settings.TunnelProfile);
            TunnelIdBox = AddField(table, 7, "自己的 Tunnel ID", settings.TunnelId);
            KeyBox = AddField(table, 8, "Runtime API Key（重新输入可选）", ""); KeyBox.UseSystemPasswordChar = true;
            DirectBridgeBox = AddCheck(table, 9, "直接启动 Bridge Node（推荐本地/portable）", settings.LaunchBridgeDirectly);
            TunnelBoxCheck = AddCheck(table, 10, "启动已配置 Tunnel", settings.StartTunnel);
            StartupBox = AddCheck(table, 11, "随 Windows 启动到系统托盘", settings.StartWithWindows);
            FlowLayoutPanel buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, Height = 42 };
            Button save = new Button { Text = "保存配置", AutoSize = true };
            Button cancel = new Button { Text = "取消", AutoSize = true, DialogResult = DialogResult.Cancel };
            save.Click += delegate { if (SaveValues()) { Saved = true; DialogResult = DialogResult.OK; Close(); } };
            cancel.Click += delegate { Close(); };
            buttons.Controls.Add(save); buttons.Controls.Add(cancel);
            table.Controls.Add(buttons, 0, 12); table.SetColumnSpan(buttons, 2);
            AcceptButton = save; CancelButton = cancel;
        }

        private TextBox AddField(TableLayoutPanel table, int row, string label, string value)
        {
            table.RowStyles.Add(new RowStyle(SizeType.Absolute, 38F));
            table.Controls.Add(new Label { Text = label, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, row);
            TextBox box = new TextBox { Text = value ?? "", Dock = DockStyle.Fill };
            table.Controls.Add(box, 1, row);
            return box;
        }

        private CheckBox AddCheck(TableLayoutPanel table, int row, string text, bool value)
        {
            table.RowStyles.Add(new RowStyle(SizeType.Absolute, 32F));
            CheckBox box = new CheckBox { Text = text, Checked = value, Dock = DockStyle.Fill };
            table.Controls.Add(box, 1, row);
            table.SetColumnSpan(box, 2);
            return box;
        }

        private bool SaveValues()
        {
            string node = NodeBox.Text.Trim();
            if (!File.Exists(node)) { MessageBox.Show("Node.js 路径不存在。", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            string root = RootBox.Text.Trim();
            string entry = DesktopSettings.ResolveBridgeEntryPath(root, Settings.BridgeEntry);
            if (!File.Exists(entry)) { MessageBox.Show("Bridge 构建入口不存在（首选 dist\\index.js，兼容 dist\\src\\index.js）：" + entry + "\n请先 npm run build，或选择 portable 包目录。", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            Uri status;
            if (!Uri.TryCreate(StatusBox.Text.Trim(), UriKind.Absolute, out status) || status.Scheme != Uri.UriSchemeHttp || (status.Host != "127.0.0.1" && status.Host != "localhost" && status.Host != "::1"))
            { MessageBox.Show("状态 API 必须是本机 loopback HTTP 地址。", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            if (TunnelBoxCheck.Checked && (string.IsNullOrEmpty(TunnelBox.Text.Trim()) || string.IsNullOrEmpty(ProfileBox.Text.Trim())))
            { MessageBox.Show("启用 Tunnel 时必须同时配置 Tunnel client 和 profile；不会猜测 profile。", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            string tunnelId = TunnelIdBox.Text.Trim();
            if ((!string.IsNullOrEmpty(tunnelId) || TunnelBoxCheck.Checked) && !V6TunnelProfile.IsTunnelId(tunnelId))
            { MessageBox.Show("请输入自己注册的完整 Tunnel ID（tunnel_ 加 32 位小写十六进制）。不要填写他人的 ID。", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            if (TunnelBoxCheck.Checked && !File.Exists(TunnelBox.Text.Trim()))
            { MessageBox.Show("Tunnel client 文件不存在。", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            if (TunnelBoxCheck.Checked && string.IsNullOrEmpty(KeyBox.Text) && !File.Exists(DesktopPaths.RuntimeKeyFile))
            { MessageBox.Show("启用 Tunnel 前请提供自己的 Runtime API Key。", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            Settings.NodeExecutable = Path.GetFullPath(node);
            Settings.CodexExecutable = CodexBox.Text.Trim();
            Settings.BridgeWorkingDirectory = Path.GetFullPath(root);
            Settings.BridgeEntry = File.Exists(Path.Combine(Settings.BridgeWorkingDirectory, "dist", "index.js")) ? "dist\\index.js" : "dist\\src\\index.js";
            Settings.StatusUrl = StatusBox.Text.Trim();
            Settings.TunnelExecutable = TunnelBox.Text.Trim();
            Settings.TunnelProfile = ProfileBox.Text.Trim();
            Settings.TunnelId = tunnelId;
            Settings.LaunchBridgeDirectly = DirectBridgeBox.Checked;
            Settings.StartTunnel = TunnelBoxCheck.Checked;
            Settings.StartWithWindows = StartupBox.Checked;
            string key = KeyBox.Text;
            if (!string.IsNullOrEmpty(key)) { SecureStore.Save(DesktopPaths.RuntimeKeyFile, key); Settings.RuntimeKeyFile = DesktopPaths.RuntimeKeyFile; key = null; }
            if (Settings.StartTunnel && !File.Exists(Settings.RuntimeKeyFile))
            { MessageBox.Show("启用 Tunnel 前必须提供 Runtime API Key，或指定现有当前用户 DPAPI 密钥文件。", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            DesktopSettings.Save(Settings);
            StartupRegistration.Set(Settings.StartWithWindows);
            return true;
        }
    }

    internal static class StartupRegistration
    {
        private const string RunKey = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        internal static void Set(bool enabled)
        {
            string valueName = DesktopPaths.IsPreview ? "BridgeCodexV6Preview" : "LocalCodexBridge";
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (enabled) key.SetValue(valueName, "\"" + Application.ExecutablePath + "\" --background", RegistryValueKind.String);
                else key.DeleteValue(valueName, false);
            }
        }
    }

    internal sealed class DashboardForm : Form
    {
        private const int WM_ENTERSIZEMOVE = 0x0231;
        private const int WM_EXITSIZEMOVE = 0x0232;
        private const int StatusRefreshIntervalMilliseconds = 4000;
        private const int InteractiveResumeDelayMilliseconds = 300;
        private static readonly Size LogicalMinimumWindowSize = new Size(640, 420);
        private readonly BridgeProcessController Controller;
        private readonly Label BridgeValue;
        private readonly Label TunnelValue;
        private readonly Label AppServerValue;
        private readonly Label ModelValue;
        private readonly Label AgentValue;
        private readonly Label WorkerValue;
        private readonly Label NativeValue;
        private readonly Label QueueValue;
        private readonly Label PendingValue;
        private readonly Label OwnershipValue;
        private readonly TextBox TasksBox;
        private readonly TextBox DiagnosticsBox;
        private readonly TableLayoutPanel RootPanel;
        private readonly TableLayoutPanel MetricsPanel;
        private readonly FlowLayoutPanel ActionsPanel;
        private readonly Label TaskHeading;
        private readonly Label DiagnosticsHeading;
        private readonly System.Windows.Forms.Timer RefreshTimer;
        private readonly System.Windows.Forms.Timer ResumeRefreshTimer;
        private readonly FormClosingEventHandler FormClosingHandler;
        private readonly EventHandler RefreshTimerTickHandler;
        private readonly EventHandler ResumeRefreshTimerTickHandler;
        private int Refreshing;
        private int BackgroundRefreshStarts;
        private int TextUpdateCount;
        private int LayoutPassCount;
        private bool InteractiveSession;
        private DashboardViewState DeferredSnapshot;
        private bool AllowClose;
        private int ShutdownStarted;

        internal DashboardForm(BridgeProcessController controller, bool debug)
        {
            Controller = controller;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            UpdateStyles();
            Text = debug ? DesktopPaths.ProductName + " [Debug]" : DesktopPaths.ProductName;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoSize = false;
            FormBorderStyle = FormBorderStyle.Sizable;
            ControlBox = true;
            MaximizeBox = true;
            MinimizeBox = true;
            MaximumSize = Size.Empty;
            MinimumSize = LogicalMinimumWindowSize;
            Width = 980;
            Height = 720;
            Font = new Font("Segoe UI", 9F);
            FormClosingHandler = delegate(object sender, FormClosingEventArgs e)
            {
                if (!AllowClose)
                {
                    e.Cancel = true;
                    if (!IsDisposed && !Disposing) Hide();
                    return;
                }
                BeginShutdown();
            };
            RefreshTimerTickHandler = delegate { if (BridgeCodexHost.IsUiUsable(this)) RefreshStatus(); };
            ResumeRefreshTimerTickHandler = delegate { if (BridgeCodexHost.IsUiUsable(this)) ResumeRefresh(); };
            FormClosing += FormClosingHandler;

            RootPanel = new TableLayoutPanel { Name = "DashboardRoot", Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 7, Padding = new Padding(16), AutoScroll = true };
            RootPanel.Layout += delegate { LayoutPassCount++; };
            RootPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 145F)); RootPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            RootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 48F));
            RootPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            RootPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 48F));
            RootPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            RootPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 48F));
            RootPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            RootPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 52F));
            Controls.Add(RootPanel);
            Label title = new Label { Text = DesktopPaths.ProductName, Font = new Font("Segoe UI Semibold", 18F), Dock = DockStyle.Fill, Height = 40 };
            RootPanel.Controls.Add(title, 0, 0); RootPanel.SetColumnSpan(title, 2);
            MetricsPanel = new TableLayoutPanel { Name = "DashboardMetrics", Dock = DockStyle.Top, Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right, ColumnCount = 4, RowCount = 3, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(0, 4, 0, 4) };
            MetricsPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            MetricsPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            MetricsPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            for (int i = 0; i < 4; i++) MetricsPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
            RootPanel.Controls.Add(MetricsPanel, 0, 1); RootPanel.SetColumnSpan(MetricsPanel, 2);
            BridgeValue = AddMetric(MetricsPanel, 0, 0, "Bridge"); TunnelValue = AddMetric(MetricsPanel, 1, 0, "Tunnel"); AppServerValue = AddMetric(MetricsPanel, 2, 0, "App Server"); ModelValue = AddMetric(MetricsPanel, 3, 0, "模型策略");
            AgentValue = AddMetric(MetricsPanel, 0, 1, "Bridge Agent / Service Codex"); WorkerValue = AddMetric(MetricsPanel, 1, 1, "Worker（上限 5）"); NativeValue = AddMetric(MetricsPanel, 2, 1, "原生/外部活跃"); QueueValue = AddMetric(MetricsPanel, 3, 1, "排队");
            PendingValue = AddMetric(MetricsPanel, 0, 2, "待确认"); OwnershipValue = AddMetric(MetricsPanel, 1, 2, "Thread ownership");
            Button start = new Button { Text = "启动", AutoSize = true }; start.Click += delegate { RunAction("启动", delegate { return Controller.Start(); }); };
            Button stop = new Button { Text = "停止", AutoSize = true }; stop.Click += delegate { RunAction("停止", delegate { return Controller.Stop(); }); };
            Button restart = new Button { Text = "重启", AutoSize = true }; restart.Click += delegate { RunAction("重启", delegate { return Controller.Restart(); }); };
            Button setup = new Button { Text = "配置向导", AutoSize = true }; setup.Click += delegate { DesktopApplicationContext.ShowSetup(); };
            Button logs = new Button { Text = "打开日志", AutoSize = true }; logs.Click += delegate { Controller.OpenLogs(); };
            Button copy = new Button { Text = "复制诊断", AutoSize = true }; copy.Click += delegate { Clipboard.SetText(Controller.Diagnostics()); MessageBox.Show("已复制不含密钥、prompt、转录和命令输出的健康诊断。", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); };
            ActionsPanel = new FlowLayoutPanel { Name = "DashboardActions", Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, Padding = new Padding(0, 4, 0, 4) };
            ActionsPanel.Controls.Add(start); ActionsPanel.Controls.Add(stop); ActionsPanel.Controls.Add(restart); ActionsPanel.Controls.Add(setup); ActionsPanel.Controls.Add(logs); ActionsPanel.Controls.Add(copy);
            RootPanel.Controls.Add(ActionsPanel, 0, 2); RootPanel.SetColumnSpan(ActionsPanel, 2);
            TaskHeading = new Label { Name = "DashboardTaskHeading", Text = "当前/最近任务（只显示标题与状态摘要）", Dock = DockStyle.Fill, AutoSize = true, Padding = new Padding(0, 4, 0, 4) };
            RootPanel.Controls.Add(TaskHeading, 0, 3); RootPanel.SetColumnSpan(TaskHeading, 2);
            TasksBox = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, BackColor = Color.White };
            RootPanel.Controls.Add(TasksBox, 0, 4); RootPanel.SetColumnSpan(TasksBox, 2);
            DiagnosticsHeading = new Label { Name = "DashboardDiagnosticsHeading", Text = "诊断路径：" + DesktopPaths.LogDirectory + "    状态 API：loopback-only", Dock = DockStyle.Fill, AutoSize = true, Padding = new Padding(0, 4, 0, 4) };
            RootPanel.Controls.Add(DiagnosticsHeading, 0, 5); RootPanel.SetColumnSpan(DiagnosticsHeading, 2);
            DiagnosticsBox = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Height = 76, BackColor = Color.White };
            RootPanel.Controls.Add(DiagnosticsBox, 0, 6); RootPanel.SetColumnSpan(DiagnosticsBox, 2);
            RefreshTimer = new System.Windows.Forms.Timer { Interval = StatusRefreshIntervalMilliseconds }; RefreshTimer.Tick += RefreshTimerTickHandler; RefreshTimer.Start();
            ResumeRefreshTimer = new System.Windows.Forms.Timer { Interval = InteractiveResumeDelayMilliseconds }; ResumeRefreshTimer.Tick += ResumeRefreshTimerTickHandler;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (IsShutdownStarted() || IsDisposed || Disposing) return;
            ApplyDpiWindowConstraints(DeviceDpi);
        }

        protected override void OnDpiChanged(DpiChangedEventArgs e)
        {
            base.OnDpiChanged(e);
            if (IsShutdownStarted() || IsDisposed || Disposing) return;
            ApplyDpiWindowConstraints(e.DeviceDpiNew);
        }

        private void ApplyDpiWindowConstraints(int dpi)
        {
            if (dpi < 96) dpi = 96;
            Size minimum = ScaleLogicalSize(LogicalMinimumWindowSize, dpi);
            if (MinimumSize != minimum) MinimumSize = minimum;
            if (Width < minimum.Width || Height < minimum.Height)
            {
                Size target = new Size(Math.Max(Width, minimum.Width), Math.Max(Height, minimum.Height));
                if (Size != target) Size = target;
            }
        }

        private static Size ScaleLogicalSize(Size logical, int dpi)
        {
            return new Size(
                Math.Max(1, (logical.Width * dpi + 48) / 96),
                Math.Max(1, (logical.Height * dpi + 48) / 96));
        }

        internal void CloseApplication()
        {
            AllowClose = true;
            BeginShutdown();
            if (IsDisposed || Disposing) return;
            try
            {
                Close();
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) BeginShutdown();
            base.Dispose(disposing);
        }

        private bool IsShutdownStarted()
        {
            return Interlocked.CompareExchange(ref ShutdownStarted, 0, 0) != 0;
        }

        private void BeginShutdown()
        {
            if (Interlocked.Exchange(ref ShutdownStarted, 1) != 0) return;
            try { FormClosing -= FormClosingHandler; } catch (InvalidOperationException) { }
            if (RefreshTimer != null)
            {
                try { RefreshTimer.Tick -= RefreshTimerTickHandler; } catch (InvalidOperationException) { }
                try { RefreshTimer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                try { RefreshTimer.Dispose(); } catch (ObjectDisposedException) { }
            }
            if (ResumeRefreshTimer != null)
            {
                try { ResumeRefreshTimer.Tick -= ResumeRefreshTimerTickHandler; } catch (InvalidOperationException) { }
                try { ResumeRefreshTimer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                try { ResumeRefreshTimer.Dispose(); } catch (ObjectDisposedException) { }
            }
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            BeginShutdown();
            base.OnFormClosed(e);
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WM_ENTERSIZEMOVE) EnterInteractiveSession();
            base.WndProc(ref message);
            if (message.Msg == WM_EXITSIZEMOVE) ExitInteractiveSession();
        }

        private void EnterInteractiveSession()
        {
            if (InteractiveSession || !BridgeCodexHost.IsUiUsable(this)) return;
            InteractiveSession = true;
            DeferredSnapshot = null;
            try { RefreshTimer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
            try { ResumeRefreshTimer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
        }

        private void ExitInteractiveSession()
        {
            if (!InteractiveSession || IsShutdownStarted() || IsDisposed || Disposing) return;
            InteractiveSession = false;
            if (!BridgeCodexHost.IsUiUsable(this)) return;
            try { RefreshTimer.Start(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
            try { ResumeRefreshTimer.Start(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
        }

        private void ResumeRefresh()
        {
            if (!BridgeCodexHost.IsUiUsable(this)) return;
            try { ResumeRefreshTimer.Stop(); } catch (ObjectDisposedException) { return; } catch (InvalidOperationException) { return; }
            if (!BridgeCodexHost.IsUiUsable(this)) return;
            DashboardViewState deferred = DeferredSnapshot;
            DeferredSnapshot = null;
            if (deferred != null) ApplySnapshot(deferred);
            RefreshStatus();
        }

        internal void RefreshStatus()
        {
            if (!BridgeCodexHost.IsUiUsable(this) || InteractiveSession) return;
            if (Interlocked.Exchange(ref Refreshing, 1) == 1) return;
            BackgroundRefreshStarts++;
            Task.Factory.StartNew(
                delegate { return Controller.ReadDashboardStatus(); },
                CancellationToken.None,
                TaskCreationOptions.DenyChildAttach,
                TaskScheduler.Default).ContinueWith(delegate(Task<DashboardViewState> task)
            {
                Interlocked.Exchange(ref Refreshing, 0);
                if (task.IsCanceled || task.IsFaulted || !BridgeCodexHost.IsUiUsable(this)) return;
                DashboardViewState state = task.Result;
                BridgeCodexHost.TryBeginInvoke(this, delegate
                {
                    if (!BridgeCodexHost.IsUiUsable(this)) return;
                    if (InteractiveSession) DeferredSnapshot = state;
                    else ApplySnapshot(state);
                });
            }, TaskScheduler.Default);
        }

        private void ApplySnapshot(DashboardViewState state)
        {
            if (state == null || !BridgeCodexHost.IsUiUsable(this)) return;
            if (InteractiveSession)
            {
                DeferredSnapshot = state;
                return;
            }
            RootPanel.SuspendLayout();
            MetricsPanel.SuspendLayout();
            try
            {
                SetTextIfChanged(BridgeValue, state.BridgeText);
                if (BridgeValue.ForeColor != (state.BridgeHealthy ? Color.ForestGreen : Color.Firebrick)) BridgeValue.ForeColor = state.BridgeHealthy ? Color.ForestGreen : Color.Firebrick;
                SetTextIfChanged(TunnelValue, state.TunnelText);
                SetTextIfChanged(AppServerValue, state.AppServerText);
                SetTextIfChanged(ModelValue, state.ModelText);
                SetTextIfChanged(AgentValue, state.AgentText);
                SetTextIfChanged(WorkerValue, state.WorkerText);
                SetTextIfChanged(NativeValue, state.NativeText);
                SetTextIfChanged(QueueValue, state.QueueText);
                SetTextIfChanged(PendingValue, state.PendingText);
                SetTextIfChanged(OwnershipValue, state.OwnershipText);
                SetTextIfChanged(TasksBox, state.TasksText);
                SetTextIfChanged(DiagnosticsBox, state.DiagnosticsText);
            }
            finally
            {
                MetricsPanel.ResumeLayout(false);
                RootPanel.ResumeLayout(false);
            }
        }

        private bool SetTextIfChanged(Control control, string value)
        {
            if (control == null || control.IsDisposed || control.Disposing) return false;
            string next = value ?? "";
            if (string.Equals(control.Text, next, StringComparison.Ordinal)) return false;
            control.Text = next;
            TextUpdateCount++;
            return true;
        }

        private void RunAction(string label, Func<string> action)
        {
            if (!BridgeCodexHost.IsUiUsable(this)) return;
            try { MessageBox.Show(action(), "Local Codex Bridge " + label, MessageBoxButtons.OK, MessageBoxIcon.Information); RefreshStatus(); }
            catch (Exception error) { MessageBox.Show(error.Message, "Local Codex Bridge " + label, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }

        private static Label AddMetric(TableLayoutPanel table, int column, int row, string title)
        {
            Panel panel = new Panel { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, MinimumSize = new Size(0, 58), Padding = new Padding(7) };
            Label caption = new Label { Text = title, Dock = DockStyle.Top, AutoSize = true, MaximumSize = new Size(220, 0), ForeColor = Color.DimGray };
            Label value = new Label { Text = "—", Dock = DockStyle.Fill, Font = new Font("Segoe UI Semibold", 10F), AutoEllipsis = true, AutoSize = false, MinimumSize = new Size(0, 26), TextAlign = ContentAlignment.MiddleLeft };
            panel.Controls.Add(value); panel.Controls.Add(caption); table.Controls.Add(panel, column, row); return value;
        }

        internal static bool RunLayoutSelfTest()
        {
            return RunLayoutSelfTestCode() == 0;
        }

        internal static int RunLayoutSelfTestCode()
        {
            float[] scales = new float[] { 1F, 1.25F, 1.5F };
            for (int index = 0; index < scales.Length; index++)
            {
                using (DashboardForm form = new DashboardForm(new BridgeProcessController(DesktopSettings.Default()), false))
                {
                    form.ClientSize = new Size(840, 600);
                    form.CreateControl();
                    form.PerformLayout();
                    if (scales[index] != 1F)
                    {
                        form.Scale(new SizeF(scales[index], scales[index]));
                        form.ClientSize = new Size((int)(840F * scales[index]), (int)(600F * scales[index]));
                        form.PerformLayout();
                    }
                    int failure = form.LayoutFailureCode();
                    if (failure != 0) return 20 + index * 10 + failure;
                }
            }
            return 0;
        }

        internal static bool RunResizeSelfTest()
        {
            return RunResizeSelfTestCode() == 0;
        }

        internal static int RunResizeSelfTestCode()
        {
            using (DashboardForm form = new DashboardForm(new BridgeProcessController(DesktopSettings.Default()), false))
            {
                if (form.FormBorderStyle != FormBorderStyle.Sizable) return 41;
                if (form.AutoSize || form.MaximumSize != Size.Empty) return 42;
                if (!form.ControlBox || !form.MaximizeBox || !form.MinimizeBox) return 43;
                form.CreateControl();
                int[] dpis = new int[] { 96, 120, 144 };
                for (int index = 0; index < dpis.Length; index++)
                {
                    form.ApplyDpiWindowConstraints(dpis[index]);
                    Size expected = ScaleLogicalSize(LogicalMinimumWindowSize, dpis[index]);
                    if (form.MinimumSize != expected) return 50 + index;
                    form.Size = new Size(expected.Width + 120, expected.Height + 80);
                    form.PerformLayout();
                    if (form.Width < expected.Width || form.Height < expected.Height) return 60 + index;
                }
            }
            return 0;
        }

        internal static bool RunResponsivenessSelfTest()
        {
            return RunResponsivenessSelfTestCode() == 0;
        }

        internal static int RunResponsivenessSelfTestCode()
        {
            float[] scales = new float[] { 1F, 1.25F, 1.5F };
            for (int index = 0; index < scales.Length; index++)
            {
                using (DashboardForm form = new DashboardForm(new BridgeProcessController(DesktopSettings.Default()), false))
                {
                    form.CreateControl();
                    form.Show();
                    form.Hide();
                    if (!form.IsHandleCreated) return 71 + index;
                    if (scales[index] != 1F)
                    {
                        form.Scale(new SizeF(scales[index], scales[index]));
                        form.ClientSize = new Size((int)(840F * scales[index]), (int)(600F * scales[index]));
                    }
                    form.PerformLayout();
                    form.LayoutPassCount = 0;
                    form.TextUpdateCount = 0;
                    form.EnterInteractiveSession();
                    for (int resizeEvent = 0; resizeEvent < 120; resizeEvent++) form.RefreshStatus();
                    if (form.BackgroundRefreshStarts != 0) return 70 + index;
                    form.ExitInteractiveSession();
                    form.RefreshTimer.Stop();
                    form.ResumeRefreshTimer.Stop();
                    DashboardViewState state = DashboardViewState.ForSelfTest();
                    form.ApplySnapshot(state);
                    int firstTextUpdateCount = form.TextUpdateCount;
                    int firstLayoutPassCount = form.LayoutPassCount;
                    if (firstTextUpdateCount == 0) return 73 + index;
                    form.ApplySnapshot(state);
                    if (form.TextUpdateCount != firstTextUpdateCount) return 76 + index;
                    if (form.LayoutPassCount != firstLayoutPassCount) return 79 + index;
                }
            }
            return 0;
        }

        private int LayoutFailureCode()
        {
            if (MetricsPanel.Bounds.Height < 150) return 1;
            if (MetricsPanel.Bounds.Width <= 0) return 2;
            Label[] values = new Label[] { BridgeValue, TunnelValue, AppServerValue, ModelValue, AgentValue, WorkerValue, NativeValue, QueueValue, PendingValue, OwnershipValue };
            for (int index = 0; index < values.Length; index++)
            {
                if (values[index].Bounds.Width <= 0) return 3;
                if (values[index].Bounds.Height <= 0) return 4;
            }
            if (MetricsPanel.Bounds.Bottom > ActionsPanel.Bounds.Top) return 5;
            if (ActionsPanel.Bounds.Bottom > TaskHeading.Bounds.Top) return 6;
            if (TasksBox.Bounds.Bottom > DiagnosticsHeading.Bounds.Top) return 7;
            if (DiagnosticsBox.Bounds.Top < DiagnosticsHeading.Bounds.Bottom) return 8;
            return 0;
        }
    }

    internal sealed class DesktopApplicationContext : ApplicationContext
    {
        private static DesktopApplicationContext Current;
        private readonly bool Debug;
        private readonly bool Background;
        private readonly bool ConfigureRequested;
        private readonly NotifyIcon Tray;
        private Form Dashboard;
        private EventHandler DashboardHandleCreatedHandler;
        private readonly BridgeProcessController Controller;
        private readonly EventWaitHandle ShowEvent;
        private readonly EventWaitHandle ExitEvent;
        private readonly ManualResetEvent SignalMonitorStopEvent = new ManualResetEvent(false);
        private Thread SignalMonitorThread;
        private System.Windows.Forms.Timer SignalFilePollTimer;
        private readonly SynchronizationContext UiContext;
        private DesktopSettings Settings;
        private bool FirstRun;
        private string MigrationMessage;
        private int Exiting;

        internal DesktopApplicationContext(bool debug, bool background, bool configureRequested, EventWaitHandle showEvent, EventWaitHandle exitEvent)
        {
            Current = this; Debug = debug; Background = background; ConfigureRequested = configureRequested;
            ShowEvent = showEvent;
            ExitEvent = exitEvent;
            SynchronizationContext currentContext = SynchronizationContext.Current;
            UiContext = currentContext is WindowsFormsSynchronizationContext ? currentContext : new WindowsFormsSynchronizationContext();
            Settings = DesktopSettings.Load(out FirstRun, out MigrationMessage);
            Controller = new BridgeProcessController(Settings);
            Dashboard = BridgeCodexHost.Create(Controller, Settings.StatusUrl, Debug, DesktopPaths.IsPreview);
            Icon icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
            Tray = new NotifyIcon { Icon = icon, Visible = true, Text = DesktopPaths.ProductName };
            Tray.DoubleClick += delegate { ShowDashboard(); };
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("打开 Local Codex Bridge", delegate { ShowDashboard(); });
            menu.MenuItems.Add("启动 Bridge", delegate { SafeAction(delegate { return Controller.Start(); }); });
            menu.MenuItems.Add("停止 Bridge", delegate { SafeAction(delegate { return Controller.Stop(); }); });
            menu.MenuItems.Add("重启 Bridge", delegate { SafeAction(delegate { return Controller.Restart(); }); });
            menu.MenuItems.Add("配置向导", delegate { ShowSetup(); });
            menu.MenuItems.Add("打开日志", delegate { Controller.OpenLogs(); });
            menu.MenuItems.Add("复制诊断", delegate { Clipboard.SetText(Controller.Diagnostics()); });
            menu.MenuItems.Add("退出 Local Codex Bridge", delegate { ExitApplication(); });
            Tray.ContextMenu = menu;
            AttachDashboard(Dashboard);
            ClearInstanceSignalFiles();
            RegisterInstanceSignals();
            // Configuration repair is an explicit user action.  A missing or
            // stale optional dependency must leave the Control Center usable
            // so its diagnostics can explain the degraded backend state.
            bool needsSetup = ConfigureRequested;
            if (needsSetup)
            {
                ShowDashboard();
                PostToUi(delegate { if (!IsExiting()) ShowSetup(); });
            }
            else
            {
                if (!Background || Debug) ShowDashboard();
                Task.Factory.StartNew(delegate { return Controller.Start(); }).ContinueWith(delegate(Task<string> result)
                {
                    if (IsExiting())
                    {
                        try { Controller.Stop(); } catch { }
                        return;
                    }
                    PostToUi(delegate
                    {
                        if (IsExiting()) return;
                        try
                        {
                            if (result.IsFaulted)
                            {
                                Tray.ShowBalloonTip(4000, "Local Codex Bridge", result.Exception.GetBaseException().Message, ToolTipIcon.Error);
                            }
                            else
                            {
                                Tray.ShowBalloonTip(2500, "Local Codex Bridge", result.Result, ToolTipIcon.Info);
                            }
                            BridgeCodexHost.Refresh(Dashboard);
                        }
                        catch (ObjectDisposedException)
                        {
                        }
                        catch (InvalidOperationException)
                        {
                        }
                    });
                });
            }
            if (!string.IsNullOrEmpty(MigrationMessage) && !Background)
            {
                PostToUi(delegate
                {
                    if (!IsExiting()) MessageBox.Show(MigrationMessage, "Local Codex Bridge 迁移", MessageBoxButtons.OK, MessageBoxIcon.Information);
                });
            }
        }

        private void AttachDashboard(Form dashboard)
        {
            if (Dashboard != null && DashboardHandleCreatedHandler != null)
            {
                try { Dashboard.HandleCreated -= DashboardHandleCreatedHandler; } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
            }
            Dashboard = dashboard;
            WindowStateStore.ApplyInitial(Dashboard);
            DashboardHandleCreatedHandler = delegate
            {
                if (IsExiting() || !BridgeCodexHost.IsUiUsable(Dashboard)) return;
                BridgeCodexHost.Refresh(Dashboard);
            };
            if (Dashboard != null) Dashboard.HandleCreated += DashboardHandleCreatedHandler;
        }

        private Form EnsureDashboard()
        {
            if (IsExiting()) return null;
            if (Dashboard != null && !Dashboard.IsDisposed && !Dashboard.Disposing) return Dashboard;
            try
            {
                AttachDashboard(BridgeCodexHost.Create(Controller, Settings.StatusUrl, Debug, DesktopPaths.IsPreview));
                return Dashboard;
            }
            catch (ObjectDisposedException)
            {
                return null;
            }
            catch (InvalidOperationException)
            {
                return null;
            }
        }

        private void RegisterInstanceSignals()
        {
            SignalMonitorThread = new Thread(MonitorInstanceSignals);
            SignalMonitorThread.IsBackground = true;
            SignalMonitorThread.Start();
            SignalFilePollTimer = new System.Windows.Forms.Timer();
            SignalFilePollTimer.Interval = 250;
            SignalFilePollTimer.Tick += delegate { PollInstanceSignalFiles(); };
            SignalFilePollTimer.Start();
        }

        private void PollInstanceSignalFiles()
        {
            if (IsExiting()) return;
            if (File.Exists(DesktopPaths.ExitSignalFile)) WriteSignalTrace("ui-poll-exit-file");
            if (ConsumeSignalFile(DesktopPaths.ExitSignalFile))
            {
                WriteSignalTrace("ui-consume-exit-file");
                ExitApplication();
                return;
            }
            if (File.Exists(DesktopPaths.ShowSignalFile)) WriteSignalTrace("ui-poll-show-file");
            if (ConsumeSignalFile(DesktopPaths.ShowSignalFile)) ShowDashboard();
        }

        private void ClearInstanceSignalFiles()
        {
            DeleteSignalFile(DesktopPaths.ShowSignalFile);
            DeleteSignalFile(DesktopPaths.ExitSignalFile);
        }

        private static void DeleteSignalFile(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            try { if (File.Exists(path)) File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }

        private static bool ConsumeSignalFile(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            try
            {
                if (!File.Exists(path)) return false;
                File.Delete(path);
                return true;
            }
            catch (IOException)
            {
                return false;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }

        private void MonitorInstanceSignals()
        {
            WaitHandle[] signals = new WaitHandle[] { SignalMonitorStopEvent, ShowEvent, ExitEvent };
            try
            {
                while (!IsExiting())
                {
                    if (ConsumeInstanceSignal(ExitEvent, DesktopPaths.ExitSignalFile))
                    {
                        WriteSignalTrace("monitor-consume-exit-event");
                        PostToUi(delegate { ExitApplication(); });
                    }
                    if (ConsumeInstanceSignal(ShowEvent, DesktopPaths.ShowSignalFile))
                    {
                        WriteSignalTrace("monitor-consume-show-event");
                        PostToUi(delegate { ShowDashboard(); });
                    }
                    if (IsExiting()) return;
                    int signaled = WaitHandle.WaitAny(signals, 100);
                    if (signaled == 0 || IsExiting()) return;
                }
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        private static bool ConsumeInstanceSignal(EventWaitHandle signal, string fallbackFile)
        {
            bool signaled = false;
            if (signal != null)
            {
                try
                {
                    signaled = signal.WaitOne(0);
                    if (signaled) signal.Reset();
                }
                catch (ObjectDisposedException)
                {
                    return false;
                }
                catch (InvalidOperationException)
                {
                    return false;
                }
            }
            // The UI timer is the sole consumer of the fallback file.  The
            // monitor thread may observe the named event, but consuming the
            // file here can lose the signal if the subsequent UI post is
            // accepted by BeginInvoke and never reaches a closing WebView
            // handle.  Keeping the file until the UI callback runs makes the
            // signal retryable and keeps shutdown fail-safe.
            return signaled;
        }

        private void PostToUi(Action action)
        {
            if (action == null || IsExiting()) return;
            bool posted = false;
            try
            {
                WriteSignalTrace("post-ui-context");
                UiContext.Post(delegate(object state)
                {
                    if (IsExiting()) return;
                    WriteSignalTrace("run-ui-context");
                    try { action(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                }, null);
                posted = true;
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            // Keep the form-handle path as a second, idempotent delivery
            // route.  ExitApplication is guarded, and the fallback file is
            // still available if both queued callbacks are rejected.
            bool handlePosted = BridgeCodexHost.TryBeginInvoke(Dashboard, delegate
            {
                WriteSignalTrace("run-form-handle");
                action();
            });
            if (!posted || !handlePosted)
            {
                if (posted) return;
            }
        }

        private void WriteSignalTrace(string message)
        {
            try
            {
                Directory.CreateDirectory(DesktopPaths.LogDirectory);
                File.AppendAllText(
                    Path.Combine(DesktopPaths.LogDirectory, "desktop-signal.log"),
                    DateTime.UtcNow.ToString("o") + " " + (message ?? "") + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch
            {
            }
        }

        internal static void ShowSetup()
        {
            DesktopApplicationContext current = Current;
            Form dashboard = current == null ? null : current.EnsureDashboard();
            if (current == null || current.IsExiting() || !BridgeCodexHost.IsUiUsable(dashboard)) return;
            using (SetupForm setup = new SetupForm(current.Settings))
            {
                if (setup.ShowDialog(dashboard) == DialogResult.OK && setup.Saved && !current.IsExiting())
                {
                    current.Settings = DesktopSettings.Load(out current.FirstRun, out current.MigrationMessage);
                    current.Controller.ReloadSettings(current.Settings);
                    BridgeCodexHost.Refresh(current.Dashboard);
                }
            }
        }

        private void ShowDashboard()
        {
            Form dashboard = EnsureDashboard();
            if (IsExiting() || dashboard == null || dashboard.IsDisposed || dashboard.Disposing) return;
            try
            {
                dashboard.Show();
                dashboard.BringToFront();
                dashboard.Activate();
                BridgeCodexHost.Refresh(dashboard);
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        private void SafeAction(Func<string> action)
        {
            if (IsExiting()) return;
            try { string result = action(); if (!IsExiting()) Tray.ShowBalloonTip(2500, "Local Codex Bridge", result, ToolTipIcon.Info); BridgeCodexHost.Refresh(Dashboard); }
            catch (Exception error) { if (!IsExiting()) { try { Tray.ShowBalloonTip(4000, "Local Codex Bridge", error.Message, ToolTipIcon.Error); } catch (ObjectDisposedException) { } } }
        }

        private void ExitApplication()
        {
            if (Interlocked.Exchange(ref Exiting, 1) != 0) return;
            WriteSignalTrace("exit-enter");
            try { SignalMonitorStopEvent.Set(); } catch (ObjectDisposedException) { }
            if (SignalMonitorThread != null && SignalMonitorThread != Thread.CurrentThread)
            {
                try { SignalMonitorThread.Join(1000); } catch (ThreadStateException) { } catch (InvalidOperationException) { }
                SignalMonitorThread = null;
            }
            WriteSignalTrace("exit-after-monitor-join");
            ClearInstanceSignalFiles();
            WriteSignalTrace("exit-after-signal-clear");
            WindowStateStore.Save(Dashboard);
            if (SignalFilePollTimer != null)
            {
                try { SignalFilePollTimer.Stop(); } catch (ObjectDisposedException) { }
                try { SignalFilePollTimer.Dispose(); } catch (ObjectDisposedException) { }
                SignalFilePollTimer = null;
            }
            try { Controller.Close(); } catch { }
            WriteSignalTrace("exit-after-controller-close");
            try { Controller.Stop(); } catch { }
            WriteSignalTrace("exit-after-controller-stop");
            try { BridgeCodexHost.ClearHostStatus(Settings.StatusUrl); } catch { }
            WriteSignalTrace("exit-after-host-status");
            try { if (Dashboard != null) Dashboard.HandleCreated -= DashboardHandleCreatedHandler; } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
            try { Tray.Visible = false; Tray.Dispose(); } catch (ObjectDisposedException) { }
            BridgeCodexHost.Close(Dashboard);
            Current = null;
            try { SignalMonitorStopEvent.Dispose(); } catch (ObjectDisposedException) { }
            WriteSignalTrace("exit-before-exit-thread");
            ExitThread();
        }

        private bool IsExiting()
        {
            return Interlocked.CompareExchange(ref Exiting, 0, 0) != 0;
        }
    }
}
