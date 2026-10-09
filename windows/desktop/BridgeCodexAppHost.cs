using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq.Expressions;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace LocalCodexBridgeDesktop
{
    internal static class BridgeCodexHost
    {
        private const string WebViewTypeName = "Microsoft.Web.WebView2.WinForms.WebView2, Microsoft.Web.WebView2.WinForms";

        internal static Form Create(BridgeProcessController controller, string statusUrl, bool debug, bool preview)
        {
            if (DetectHostMode() == "WebView2")
            {
                return new BridgeCodexWebViewForm(controller, statusUrl, debug, preview);
            }
            RecordHostStatus("WinForms", false, AppUrl(statusUrl), "webview2-unavailable");
            return new DashboardForm(controller, debug);
        }

        internal static bool IsUiUsable(Form window)
        {
            if (window == null) return false;
            try
            {
                return !window.IsDisposed && !window.Disposing && window.IsHandleCreated;
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

        internal static bool TryBeginInvoke(Form window, Action action)
        {
            if (action == null || !IsUiUsable(window)) return false;
            try
            {
                window.BeginInvoke((Action)delegate
                {
                    if (!IsUiUsable(window)) return;
                    try
                    {
                        action();
                    }
                    catch (ObjectDisposedException)
                    {
                    }
                    catch (InvalidOperationException)
                    {
                    }
                });
                return true;
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

        internal static void Refresh(Form window)
        {
            if (!IsUiUsable(window)) return;
            BridgeCodexWebViewForm webViewWindow = window as BridgeCodexWebViewForm;
            if (webViewWindow != null) webViewWindow.RefreshStatus();
            DashboardForm dashboard = window as DashboardForm;
            if (dashboard != null) dashboard.RefreshStatus();
        }

        internal static void Close(Form window)
        {
            BridgeCodexWebViewForm webViewWindow = window as BridgeCodexWebViewForm;
            if (webViewWindow != null) webViewWindow.CloseApplication();
            DashboardForm dashboard = window as DashboardForm;
            if (dashboard != null) dashboard.CloseApplication();
        }

        internal static int RunSelfTestCode()
        {
            Uri uri;
            if (!Uri.TryCreate("http://127.0.0.1:37821/api/status", UriKind.Absolute, out uri)) return 91;
            string appUrl = AppUrl(uri.ToString());
            if (!string.Equals(appUrl, "http://127.0.0.1:37821/app", StringComparison.Ordinal)) return 92;
            if (!BridgeCodexWebViewForm.IsLegacyStatusUrlForSelfTest("http://127.0.0.1:37931/status", "http://127.0.0.1:37931/app")) return 93;
            if (BridgeCodexWebViewForm.IsLegacyStatusUrlForSelfTest("http://127.0.0.1:37931/app", "http://127.0.0.1:37931/app")) return 94;
            return 0;
        }

        internal static string DetectHostMode()
        {
            return WebView2Type() != null && WebView2RuntimeAvailable() ? "WebView2" : "WinForms";
        }

        private static Type WebView2Type()
        {
            Type type = Type.GetType(WebViewTypeName, false);
            if (type != null) return type;
            try
            {
                Assembly assembly = Assembly.Load("Microsoft.Web.WebView2.WinForms");
                type = assembly.GetType("Microsoft.Web.WebView2.WinForms.WebView2", false);
                if (type != null) return type;
            }
            catch
            {
            }
            try
            {
                string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Microsoft.Web.WebView2.WinForms.dll");
                if (File.Exists(path))
                {
                    Assembly assembly = Assembly.LoadFrom(path);
                    return assembly.GetType("Microsoft.Web.WebView2.WinForms.WebView2", false);
                }
            }
            catch
            {
            }
            return null;
        }

        private static bool WebView2RuntimeAvailable()
        {
            Type coreType = Type.GetType("Microsoft.Web.WebView2.Core.CoreWebView2Environment, Microsoft.Web.WebView2.Core", false);
            if (coreType == null)
            {
                try
                {
                    Assembly assembly = Assembly.Load("Microsoft.Web.WebView2.Core");
                    coreType = assembly.GetType("Microsoft.Web.WebView2.Core.CoreWebView2Environment", false);
                }
                catch
                {
                }
            }
            if (coreType == null)
            {
                try
                {
                    string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Microsoft.Web.WebView2.Core.dll");
                    if (File.Exists(path))
                    {
                        Assembly assembly = Assembly.LoadFrom(path);
                        coreType = assembly.GetType("Microsoft.Web.WebView2.Core.CoreWebView2Environment", false);
                    }
                }
                catch
                {
                }
            }
            if (coreType == null) return false;
            try
            {
                MethodInfo method = null;
                MethodInfo[] methods = coreType.GetMethods(BindingFlags.Public | BindingFlags.Static);
                for (int index = 0; index < methods.Length; index++)
                {
                    if (methods[index].Name == "GetAvailableBrowserVersionString")
                    {
                        method = methods[index];
                        break;
                    }
                }
                if (method == null) return false;
                ParameterInfo[] parameters = method.GetParameters();
                object[] arguments = parameters.Length == 0 ? new object[0] : new object[] { null };
                object result = method.Invoke(null, arguments);
                return result is string && !string.IsNullOrEmpty((string)result);
            }
            catch
            {
                return false;
            }
        }

        internal static void RecordHostStatus(string mode, bool appLoaded, string appUrl, string detail)
        {
            if (!DesktopPaths.IsPreview) return;
            WriteHostStatus(mode, appLoaded, appUrl, detail, Process.GetCurrentProcess().Id);
        }

        internal static void RecordClientError(string appUrl, string kind, string message, string stack, string source, string line, string column)
        {
            if (!DesktopPaths.IsPreview) return;
            string safeKind = SafeClientText(kind, 120);
            string safeMessage = SafeClientText(message, 2000);
            string safeStack = SafeClientText(stack, 8000);
            string safeSource = SafeClientText(source, 1000);
            try
            {
                Directory.CreateDirectory(DesktopPaths.LogDirectory);
                string path = Path.Combine(DesktopPaths.LogDirectory, "webview-client-errors.log");
                string entry = DateTime.UtcNow.ToString("o") + " kind=" + safeKind + " source=" + safeSource + " line=" + SafeClientText(line, 32) + " column=" + SafeClientText(column, 32) + Environment.NewLine + safeMessage + Environment.NewLine + safeStack + Environment.NewLine;
                File.AppendAllText(path, entry, new UTF8Encoding(false));
            }
            catch
            {
            }
            string summary = safeMessage.Replace("\r", " ").Replace("\n", " ");
            if (summary.Length > 240) summary = summary.Substring(0, 240);
            RecordHostStatus("WebView2", false, appUrl, "client-error:" + safeKind + ":" + summary);
        }

        private static string SafeClientText(string value, int maxLength)
        {
            string text = value ?? "";
            return text.Length <= maxLength ? text : text.Substring(0, maxLength);
        }

        internal static void ClearHostStatus(string statusUrl)
        {
            if (!DesktopPaths.IsPreview) return;
            WriteHostStatus("stopped", false, AppUrl(statusUrl), "stopped", 0);
        }

        private static void WriteHostStatus(string mode, bool appLoaded, string appUrl, string detail, int hostPid)
        {
            try
            {
                Directory.CreateDirectory(DesktopPaths.RunDirectory);
                Dictionary<string, object> status = new Dictionary<string, object>();
                status["schemaVersion"] = 1;
                status["host_mode"] = mode;
                status["app_loaded"] = appLoaded;
                status["app_url"] = appUrl;
                status["detail"] = detail ?? "";
                status["host_pid"] = hostPid;
                status["updated_at"] = DateTime.UtcNow.ToString("o");
                File.WriteAllText(DesktopPaths.HostStatusFile, new JavaScriptSerializer().Serialize(status) + Environment.NewLine, new UTF8Encoding(false));
            }
            catch
            {
            }
        }

        internal static string AppUrl(string statusUrl)
        {
            Uri uri;
            if (!Uri.TryCreate(statusUrl, UriKind.Absolute, out uri)) return "";
            return uri.GetLeftPart(UriPartial.Authority) + "/app";
        }

        internal static string RuntimeStatusUrl(string configuredStatusUrl)
        {
            if (!DesktopPaths.IsPreview) return configuredStatusUrl ?? "";
            if (!File.Exists(DesktopPaths.StatusUrlFile)) return "";
            try
            {
                Dictionary<string, object> value = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(DesktopPaths.StatusUrlFile, Encoding.UTF8)) as Dictionary<string, object>;
                if (value == null || !string.Equals(Convert.ToString(value.ContainsKey("state") ? value["state"] : ""), "ready", StringComparison.OrdinalIgnoreCase)) return "";
                string url = Convert.ToString(value.ContainsKey("url") ? value["url"] : "");
                Uri uri;
                if (!Uri.TryCreate(url, UriKind.Absolute, out uri)) return "";
                if (uri.Scheme != Uri.UriSchemeHttp || (uri.Host != "127.0.0.1" && uri.Host != "localhost") || uri.Port < 1 || uri.Port > 65535) return "";
                return uri.ToString();
            }
            catch
            {
                return "";
            }
        }
    }

    internal sealed class BridgeCodexWebViewForm : Form
    {
        private readonly BridgeProcessController Controller;
        private readonly string ConfiguredStatusUrl;
        private string AppUrl;
        private readonly bool Debug;
        private readonly Type WebViewType;
        private readonly EventHandler ShownHandler;
        private EventInfo NavigationEvent;
        private Delegate NavigationCompletedHandler;
        private EventInfo NavigationStartingEvent;
        private Delegate NavigationStartingHandler;
        private object WebViewCore;
        private EventInfo NewWindowEvent;
        private Delegate NewWindowRequestedHandler;
        private EventInfo WebMessageEvent;
        private Delegate WebMessageReceivedHandler;
        private EventHandler NavigationRetryTickHandler;
        private Control WebView;
        private System.Windows.Forms.Timer NavigationRetryTimer;
        private System.Windows.Forms.Timer WebViewReadyTimeoutTimer;
        private EventHandler WebViewReadyTimeoutTickHandler;
        private EventInfo ProcessFailedEvent;
        private Delegate ProcessFailedHandler;
        private string FailureDetail;
        private int NavigationAttempts;
        private int ShutdownStarted;
        private bool AllowClose;
        private bool BootstrapDocument;

        internal BridgeCodexWebViewForm(BridgeProcessController controller, string statusUrl, bool debug, bool preview)
        {
            Controller = controller;
            ConfiguredStatusUrl = statusUrl ?? "";
            Text = "Local Codex Bridge";
            Debug = debug;
            AppUrl = BridgeCodexHost.AppUrl(statusUrl);
            // ApplicationContext shows the form while its constructor is still
            // running, before Application.Run has entered the message pump.
            // WebView2 initialization must be queued onto that pump; starting
            // EnsureCoreWebView2Async synchronously from Shown can leave the
            // control permanently black while its Task remains pending.
            ShownHandler = delegate { BridgeCodexHost.TryBeginInvoke(this, InitializeWebView2); };
            NavigationRetryTickHandler = delegate { OnNavigationRetryTick(); };
            WebViewReadyTimeoutTickHandler = delegate { OnWebViewReadyTimeoutTick(); };
            WebViewType = Type.GetType("Microsoft.Web.WebView2.WinForms.WebView2, Microsoft.Web.WebView2.WinForms", false);
            if (WebViewType == null)
            {
                ShowUnavailable();
                return;
            }
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            MinimumSize = new Size(640, 420);
            // Give the WebView host a usable baseline before the first handle
            // is created. WindowStateStore may replace this with a valid saved
            // Normal placement; otherwise a fresh launch must be maximized.
            Width = 1200;
            Height = 820;
            WindowState = FormWindowState.Maximized;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(16, 17, 19);
            try
            {
                WebView = Activator.CreateInstance(WebViewType) as Control;
                if (WebView == null) throw new InvalidOperationException("WebView2 control could not be created");
                WebView.Dock = DockStyle.Fill;
                Controls.Add(WebView);
                EventInfo navigation = WebViewType.GetEvent("NavigationCompleted");
                if (navigation != null)
                {
                    Delegate handler = CreateNavigationCompletedHandler(navigation);
                    if (handler != null)
                    {
                        NavigationEvent = navigation;
                        NavigationCompletedHandler = handler;
                        navigation.AddEventHandler(WebView, handler);
                    }
                }
                EventInfo navigationStarting = WebViewType.GetEvent("NavigationStarting");
                if (navigationStarting != null)
                {
                    Delegate handler = CreateNavigationStartingHandler(navigationStarting);
                    if (handler != null)
                    {
                        NavigationStartingEvent = navigationStarting;
                        NavigationStartingHandler = handler;
                        navigationStarting.AddEventHandler(WebView, handler);
                    }
                }
                BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, "initializing");
                Shown += ShownHandler;
            }
            catch
            {
                ShowUnavailable();
            }
        }

        internal void RefreshStatus()
        {
            // The app shell owns event-driven refresh through /api/events.
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

        private void InitializeWebView2()
        {
            if (!IsUiCallbackAlive() || WebView == null) return;
            try
            {
                StartWebViewReadyTimeout();
                MethodInfo ensure = FindEnsureCoreWebView2Method();
                if (ensure != null)
                {
                    ParameterInfo[] parameters = ensure.GetParameters();
                    Task task = ensure.Invoke(WebView, new object[parameters.Length]) as Task;
                    if (task != null)
                    {
                        task.ContinueWith(delegate(Task completed)
                        {
                            if (!IsUiCallbackAlive()) return;
                            try
                            {
                                if (completed.IsCanceled || completed.IsFaulted)
                                {
                                    if (!IsUiCallbackAlive()) return;
                                    string detail = completed.IsCanceled
                                        ? "webview2-initialization-canceled"
                                        : "webview2-initialization-failed:" + (completed.Exception == null ? "unknown" : completed.Exception.GetBaseException().GetType().Name);
                                    BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, detail);
                                    BridgeCodexHost.TryBeginInvoke(this, delegate { StopWebViewReadyTimeout(); ShowUnavailable(detail); });
                                    return;
                                }
                                BridgeCodexHost.TryBeginInvoke(this, delegate
                                {
                                    AttachNewWindowEvent();
                                    ShowBootstrapPage("正在等待 Bridge Host");
                                    ScheduleNavigationRetry();
                                });
                            }
                            catch (ObjectDisposedException)
                            {
                            }
                            catch (InvalidOperationException)
                            {
                            }
                            catch
                            {
                                if (IsUiCallbackAlive()) BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, "initialization-callback-failed");
                            }
                        }, CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default);
                        return;
                    }
                }
                ShowUnavailable("webview2-initialization-api-unavailable");
            }
            catch (Exception error)
            {
                string detail = "webview2-initialization-exception:" + error.GetBaseException().GetType().Name;
                FailureDetail = detail;
                BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, detail);
                ShowUnavailable(detail);
            }
        }

        private MethodInfo FindEnsureCoreWebView2Method()
        {
            MethodInfo selected = null;
            MethodInfo[] methods = WebViewType.GetMethods(BindingFlags.Public | BindingFlags.Instance);
            for (int index = 0; index < methods.Length; index++)
            {
                MethodInfo method = methods[index];
                if (!string.Equals(method.Name, "EnsureCoreWebView2Async", StringComparison.Ordinal)) continue;
                if (selected == null || method.GetParameters().Length < selected.GetParameters().Length) selected = method;
            }
            return selected;
        }

        private void ShowBootstrapPage(string detail)
        {
            if (!IsUiCallbackAlive() || WebView == null) return;
            try
            {
                MethodInfo navigateToString = WebViewType.GetMethod("NavigateToString", new Type[] { typeof(string) });
                if (navigateToString == null) return;
                BootstrapDocument = true;
                string safeDetail = (detail ?? "正在等待本机服务").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");
                string html = "<!doctype html><html><head><meta charset='utf-8'><style>body{margin:0;background:#101113;color:#e4e8ed;font-family:Segoe UI,Microsoft YaHei,sans-serif;display:grid;place-items:center;min-height:100vh}.panel{width:min(680px,calc(100vw - 64px));padding:32px;border:1px solid #303841;border-radius:16px;background:#171a1f;box-sizing:border-box}.eyebrow{color:#78d8c8;letter-spacing:.12em;font-size:12px}.title{font-size:28px;font-weight:600;margin-top:10px}.detail{color:#aab5c2;margin-top:12px;line-height:1.6}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}button{border:1px solid #4a6268;background:#20262c;color:#e4e8ed;border-radius:8px;padding:9px 14px;font:inherit;cursor:pointer}button:hover{border-color:#78d8c8;color:#78d8c8}</style></head><body><main class='panel'><div class='eyebrow'>LOCAL CODEX BRIDGE</div><div class='title'>Control Center 正在启动</div><div class='detail'>" + safeDetail + "<br>后台服务可以稍后就绪；界面不会因为暂时不可用而退出。</div><div class='actions'><button id='reload'>重新加载界面</button><button id='restart'>重新启动 Control Center Host</button><button id='copy'>复制诊断</button><button id='logs'>打开日志</button><button id='exit'>退出</button></div></main><script>function post(type){try{if(window.chrome&&window.chrome.webview)window.chrome.webview.postMessage(JSON.stringify({type:type}))}catch(e){}}document.getElementById('reload').onclick=function(){post('reload-control-center')};document.getElementById('restart').onclick=function(){post('restart-control-center')};document.getElementById('copy').onclick=function(){post('copy-diagnostics')};document.getElementById('logs').onclick=function(){post('open-logs')};document.getElementById('exit').onclick=function(){post('exit-bridge')};</script></body></html>";
                navigateToString.Invoke(WebView, new object[] { html });
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch
            {
                ShowUnavailable(detail);
            }
        }

        private void Navigate()
        {
            if (!IsUiCallbackAlive() || WebView == null) return;
            string runtimeStatusUrl = BridgeCodexHost.RuntimeStatusUrl(ConfiguredStatusUrl);
            if (string.IsNullOrEmpty(runtimeStatusUrl))
            {
                if (NavigationAttempts >= 60)
                {
                    const string detail = "bridge-host-readiness-timeout";
                    FailureDetail = detail;
                    BridgeCodexHost.RecordHostStatus("WebView2", false, "", detail);
                    ShowUnavailable(detail);
                    return;
                }
                NavigationAttempts++;
                ScheduleNavigationRetry();
                return;
            }
            AppUrl = BridgeCodexHost.AppUrl(runtimeStatusUrl);
            if (string.IsNullOrEmpty(AppUrl)) return;
            if (NavigationAttempts >= 60)
            {
                BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, "app-route-not-ready");
                ShowUnavailable();
                return;
            }
            try
            {
                NavigationAttempts++;
                BootstrapDocument = false;
                PropertyInfo source = WebViewType.GetProperty("Source");
                if (source == null) throw new InvalidOperationException("WebView2 Source property was not found");
                source.SetValue(WebView, new Uri(AppUrl), null);
            }
            catch
            {
                if (!IsUiCallbackAlive()) return;
                BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, "navigation-start-failed");
                ShowUnavailable();
            }
        }

        private Delegate CreateNavigationCompletedHandler(EventInfo navigation)
        {
            return CreateWebViewEventHandler(navigation, "OnNavigationCompleted");
        }

        private Delegate CreateNavigationStartingHandler(EventInfo navigation)
        {
            return CreateWebViewEventHandler(navigation, "OnNavigationStarting");
        }

        private Delegate CreateNewWindowRequestedHandler(EventInfo navigation)
        {
            return CreateWebViewEventHandler(navigation, "OnNewWindowRequested");
        }

        private Delegate CreateWebMessageReceivedHandler(EventInfo webMessage)
        {
            return CreateWebViewEventHandler(webMessage, "OnWebMessageReceived");
        }

        private Delegate CreateProcessFailedHandler(EventInfo processFailed)
        {
            return CreateWebViewEventHandler(processFailed, "OnProcessFailed");
        }

        private Delegate CreateWebViewEventHandler(EventInfo navigation, string callbackName)
        {
            if (navigation.EventHandlerType == null) return null;
            MethodInfo callback = GetType().GetMethod(callbackName, BindingFlags.Instance | BindingFlags.NonPublic);
            MethodInfo invoke = navigation.EventHandlerType.GetMethod("Invoke");
            if (callback == null || invoke == null) return null;
            ParameterInfo[] parameters = invoke.GetParameters();
            if (parameters.Length != 2) return null;
            ParameterExpression sender = Expression.Parameter(parameters[0].ParameterType, "sender");
            ParameterExpression args = Expression.Parameter(parameters[1].ParameterType, "args");
            MethodCallExpression call = Expression.Call(
                Expression.Constant(this),
                callback,
                Expression.Convert(sender, typeof(object)),
                Expression.Convert(args, typeof(object)));
            return Expression.Lambda(navigation.EventHandlerType, call, sender, args).Compile();
        }

        private void OnNavigationStarting(object sender, object args)
        {
            if (!IsUiCallbackAlive() || args == null) return;
            string url = ReadStringProperty(args, "Uri");
            if (!IsLegacyStatusUrl(url)) return;
            SetBooleanProperty(args, "Cancel", true);
            OpenExternalUrl(url);
        }

        private void OnNewWindowRequested(object sender, object args)
        {
            if (!IsUiCallbackAlive() || args == null) return;
            string url = ReadStringProperty(args, "Uri");
            if (!IsLegacyStatusUrl(url)) return;
            SetBooleanProperty(args, "Handled", true);
            OpenExternalUrl(url);
        }

        private static string ReadStringProperty(object instance, string name)
        {
            try
            {
                PropertyInfo property = instance.GetType().GetProperty(name);
                return property == null ? "" : Convert.ToString(property.GetValue(instance, null));
            }
            catch (ObjectDisposedException)
            {
                return "";
            }
            catch (InvalidOperationException)
            {
                return "";
            }
            catch
            {
                return "";
            }
        }

        private static void SetBooleanProperty(object instance, string name, bool value)
        {
            try
            {
                PropertyInfo property = instance.GetType().GetProperty(name);
                if (property != null && property.CanWrite && property.PropertyType == typeof(bool)) property.SetValue(instance, value, null);
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch
            {
            }
        }

        private bool IsLegacyStatusUrl(string url)
        {
            return IsLegacyStatusUrlForSelfTest(url, AppUrl);
        }

        internal static bool IsLegacyStatusUrlForSelfTest(string url, string appUrl)
        {
            Uri target;
            Uri app;
            if (!Uri.TryCreate(url, UriKind.Absolute, out target) || !Uri.TryCreate(appUrl, UriKind.Absolute, out app)) return false;
            return string.Equals(target.Scheme, app.Scheme, StringComparison.OrdinalIgnoreCase)
                && string.Equals(target.Host, app.Host, StringComparison.OrdinalIgnoreCase)
                && target.Port == app.Port
                && string.Equals(target.AbsolutePath.TrimEnd('/'), "/status", StringComparison.OrdinalIgnoreCase);
        }

        private static void OpenExternalUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch
            {
            }
        }

        private void AttachNewWindowEvent()
        {
            if (!IsUiCallbackAlive() || WebView == null) return;
            try
            {
                PropertyInfo coreProperty = WebViewType.GetProperty("CoreWebView2");
                object core = coreProperty == null ? null : coreProperty.GetValue(WebView, null);
                if (core == null) return;
                WebViewCore = core;
                if (ProcessFailedEvent == null)
                {
                    EventInfo processFailed = core.GetType().GetEvent("ProcessFailed");
                    if (processFailed != null)
                    {
                        Delegate handler = CreateProcessFailedHandler(processFailed);
                        if (handler != null)
                        {
                            ProcessFailedEvent = processFailed;
                            ProcessFailedHandler = handler;
                            processFailed.AddEventHandler(core, handler);
                        }
                    }
                }
                if (NewWindowEvent == null)
                {
                    EventInfo newWindow = core.GetType().GetEvent("NewWindowRequested");
                    if (newWindow != null)
                    {
                        Delegate handler = CreateNewWindowRequestedHandler(newWindow);
                        if (handler != null)
                        {
                            NewWindowEvent = newWindow;
                            NewWindowRequestedHandler = handler;
                            newWindow.AddEventHandler(core, handler);
                        }
                    }
                }
                if (WebMessageEvent == null)
                {
                    EventInfo webMessage = core.GetType().GetEvent("WebMessageReceived");
                    if (webMessage != null)
                    {
                        Delegate handler = CreateWebMessageReceivedHandler(webMessage);
                        if (handler != null)
                        {
                            WebMessageEvent = webMessage;
                            WebMessageReceivedHandler = handler;
                            webMessage.AddEventHandler(core, handler);
                        }
                    }
                }
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
                WebViewCore = null;
                NewWindowEvent = null;
                NewWindowRequestedHandler = null;
                WebMessageEvent = null;
                WebMessageReceivedHandler = null;
                ProcessFailedEvent = null;
                ProcessFailedHandler = null;
            }
            catch
            {
                WebViewCore = null;
                NewWindowEvent = null;
                NewWindowRequestedHandler = null;
                WebMessageEvent = null;
                WebMessageReceivedHandler = null;
                ProcessFailedEvent = null;
                ProcessFailedHandler = null;
            }
        }

        private void OnProcessFailed(object sender, object args)
        {
            if (!IsUiCallbackAlive()) return;
            string kind = ReadStringProperty(args, "ProcessFailedKind");
            string reason = ReadStringProperty(args, "Reason");
            string detail = "webview2-process-failed" + (string.IsNullOrEmpty(kind) ? "" : ":" + kind) + (string.IsNullOrEmpty(reason) ? "" : ":" + reason);
            FailureDetail = detail;
            BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, detail);
            BridgeCodexHost.TryBeginInvoke(this, delegate { ShowUnavailable(detail); });
        }

        private void OnWebMessageReceived(object sender, object args)
        {
            if (!IsUiCallbackAlive() || args == null) return;
            try
            {
                if (InvokeRequired)
                {
                    BridgeCodexHost.TryBeginInvoke(this, delegate { HandleWebMessage(args); });
                    return;
                }
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (InvalidOperationException)
            {
                return;
            }
            HandleWebMessage(args);
        }

        private void HandleWebMessage(object args)
        {
            if (!IsUiCallbackAlive() || args == null) return;
            string message = ReadStringProperty(args, "WebMessageAsJson");
            if (string.IsNullOrEmpty(message))
            {
                try
                {
                    MethodInfo method = args.GetType().GetMethod("TryGetWebMessageAsString", Type.EmptyTypes);
                    if (method != null) message = Convert.ToString(method.Invoke(args, new object[0]));
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
                catch
                {
                }
            }
            if (string.IsNullOrEmpty(message)) return;
            if (message.IndexOf("reload-control-center", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                NavigationAttempts = 0;
                FailureDetail = "";
                ShowBootstrapPage("正在重新加载 Control Center");
                ScheduleNavigationRetry();
                return;
            }
            if (message.IndexOf("restart-control-center", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                Task.Factory.StartNew(delegate
                {
                    try { Controller.Start(); } catch { }
                }).ContinueWith(delegate
                {
                    BridgeCodexHost.TryBeginInvoke(this, delegate
                    {
                        NavigationAttempts = 0;
                        FailureDetail = "";
                        ShowBootstrapPage("正在重新启动 Control Center Host");
                        ScheduleNavigationRetry();
                    });
                }, TaskScheduler.Default);
                return;
            }
            if (message.IndexOf("copy-diagnostics", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                try { Clipboard.SetText(Controller.Diagnostics()); } catch { }
                return;
            }
            if (message.IndexOf("open-logs", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                try { Controller.OpenLogs(); } catch { }
                return;
            }
            if (message.IndexOf("exit-bridge", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                CloseApplication();
                return;
            }
            try
            {
                Dictionary<string, object> payload = new JavaScriptSerializer().DeserializeObject(message) as Dictionary<string, object>;
                if (payload != null && string.Equals(Convert.ToString(payload.ContainsKey("type") ? payload["type"] : ""), "client-error", StringComparison.OrdinalIgnoreCase))
                {
                    BridgeCodexHost.RecordClientError(
                        AppUrl,
                        Convert.ToString(payload.ContainsKey("kind") ? payload["kind"] : "client-error"),
                        Convert.ToString(payload.ContainsKey("message") ? payload["message"] : ""),
                        Convert.ToString(payload.ContainsKey("stack") ? payload["stack"] : ""),
                        Convert.ToString(payload.ContainsKey("source") ? payload["source"] : ""),
                        Convert.ToString(payload.ContainsKey("line") ? payload["line"] : ""),
                        Convert.ToString(payload.ContainsKey("column") ? payload["column"] : ""));
                    return;
                }
            }
            catch
            {
            }
            if (message.IndexOf("select-folder", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                // Do not open a modal WinForms dialog inline while WebView2 is
                // dispatching the originating mouse/message callback. Queue it
                // to the form's UI message loop so the click can finish first.
                BridgeCodexHost.TryBeginInvoke(this, ShowFolderPicker);
            }
            else if (message.IndexOf("open-logs", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                BridgeCodexHost.TryBeginInvoke(this, OpenLogsDirectory);
            }
        }

        private void ShowFolderPicker()
        {
            if (!IsUiCallbackAlive()) return;
            try
            {
                using (FolderBrowserDialog dialog = new FolderBrowserDialog())
                {
                    dialog.Description = "选择工作目录";
                    dialog.ShowNewFolderButton = false;
                    if (dialog.ShowDialog(this) == DialogResult.OK && !string.IsNullOrWhiteSpace(dialog.SelectedPath) && Directory.Exists(dialog.SelectedPath))
                    {
                        PostWebMessage("folder-selected", dialog.SelectedPath);
                    }
                    else
                    {
                        PostWebMessage("folder-picker-cancelled", "");
                    }
                }
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch
            {
                PostWebMessage("folder-picker-cancelled", "");
            }
        }

        private void OpenLogsDirectory()
        {
            if (!IsUiCallbackAlive()) return;
            try
            {
                Directory.CreateDirectory(DesktopPaths.LogDirectory);
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + DesktopPaths.LogDirectory.Replace("\"", "") + "\"") { UseShellExecute = true });
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch
            {
            }
        }

        private void PostWebMessage(string type, string path)
        {
            if (!IsUiCallbackAlive() || WebViewCore == null) return;
            try
            {
                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["type"] = type;
                if (!string.IsNullOrEmpty(path)) payload["path"] = path;
                string json = new JavaScriptSerializer().Serialize(payload);
                MethodInfo method = WebViewCore.GetType().GetMethod("PostWebMessageAsJson", new Type[] { typeof(string) });
                if (method != null)
                {
                    method.Invoke(WebViewCore, new object[] { json });
                    return;
                }
                MethodInfo stringMethod = WebViewCore.GetType().GetMethod("PostWebMessageAsString", new Type[] { typeof(string) });
                if (stringMethod != null) stringMethod.Invoke(WebViewCore, new object[] { json });
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch
            {
            }
        }

        private void OnNavigationCompleted(object sender, object args)
        {
            if (!IsUiCallbackAlive()) return;
            bool success = false;
            string detail = "navigation-failed";
            if (args != null)
            {
                PropertyInfo isSuccess = args.GetType().GetProperty("IsSuccess");
                if (isSuccess != null && isSuccess.PropertyType == typeof(bool)) success = (bool)isSuccess.GetValue(args, null);
                PropertyInfo webError = args.GetType().GetProperty("WebErrorStatus");
                detail = success ? "navigation-completed" : "navigation-failed:" + (webError == null ? "unknown" : Convert.ToString(webError.GetValue(args, null)));
            }
            if (!success)
            {
                if (!IsUiCallbackAlive()) return;
                BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, detail);
                ScheduleNavigationRetry();
                return;
            }
            if (!IsUiCallbackAlive()) return;
            if (BootstrapDocument)
            {
                BootstrapDocument = false;
                StopWebViewReadyTimeout();
                ScheduleNavigationRetry();
                return;
            }
            StopWebViewReadyTimeout();
            // CoreWebView2 can become available just after EnsureCoreWebView2Async
            // completes. Re-run the idempotent event attachment after the first
            // real document navigation so WebMessageReceived cannot be lost.
            AttachNewWindowEvent();
            VerifyControlCenterDom();
        }

        private void VerifyControlCenterDom()
        {
            if (!IsUiCallbackAlive() || WebViewCore == null) return;
            try
            {
                MethodInfo execute = WebViewCore.GetType().GetMethod("ExecuteScriptAsync", new Type[] { typeof(string) });
                if (execute == null)
                {
                    BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, "control-center-dom-probe-unavailable");
                    ShowUnavailable("control-center-dom-probe-unavailable");
                    return;
                }
                const string script = "(function(){return !!(document.documentElement && document.documentElement.dataset && document.documentElement.dataset.controlCenterReady === 'true' && document.querySelector('[data-page-view=overview]'));})()";
                Task task = execute.Invoke(WebViewCore, new object[] { script }) as Task;
                if (task == null)
                {
                    BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, "control-center-dom-probe-unavailable");
                    ShowUnavailable("control-center-dom-probe-unavailable");
                    return;
                }
                task.ContinueWith(delegate(Task completed)
                {
                    bool ready = false;
                    try
                    {
                        PropertyInfo result = completed.GetType().GetProperty("Result");
                        string value = result == null ? "" : Convert.ToString(result.GetValue(completed, null));
                        ready = string.Equals(value, "true", StringComparison.OrdinalIgnoreCase) || string.Equals(value, "\"true\"", StringComparison.OrdinalIgnoreCase);
                    }
                    catch
                    {
                        ready = false;
                    }
                    BridgeCodexHost.TryBeginInvoke(this, delegate
                    {
                        if (!IsUiCallbackAlive()) return;
                        if (ready)
                        {
                            StopWebViewReadyTimeout();
                            BridgeCodexHost.RecordHostStatus("WebView2", true, AppUrl, "control-center-dom-ready");
                        }
                        else
                        {
                            BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, "control-center-dom-not-ready");
                            ScheduleNavigationRetry();
                        }
                    });
                }, CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default);
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch
            {
                if (IsUiCallbackAlive()) ShowUnavailable("control-center-dom-probe-failed");
            }
        }

        private void VerifyAppEndpoint()
        {
            if (!IsUiCallbackAlive()) return;
            Task.Factory.StartNew(delegate
            {
                bool loaded = false;
                string detail = "app-http-failed";
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(AppUrl);
                    request.Timeout = 3000;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        loaded = response.StatusCode == HttpStatusCode.OK && response.ContentLength != 0;
                        detail = loaded ? "app-http-200" : "app-http-" + (int)response.StatusCode;
                    }
                }
                catch (Exception error)
                {
                    detail = "app-http-error:" + error.GetType().Name;
                }
                if (!IsUiCallbackAlive()) return;
                BridgeCodexHost.TryBeginInvoke(this, delegate
                {
                    if (!IsUiCallbackAlive()) return;
                    if (loaded)
                    {
                        BridgeCodexHost.RecordHostStatus("WebView2", true, AppUrl, detail);
                    }
                    else
                    {
                        BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, detail);
                        ScheduleNavigationRetry();
                    }
                });
            });
        }

        private void ScheduleNavigationRetry()
        {
            if (NavigationAttempts >= 60 || !IsUiCallbackAlive()) return;
            System.Windows.Forms.Timer timer = NavigationRetryTimer;
            if (timer == null)
            {
                timer = new System.Windows.Forms.Timer { Interval = 400 };
                timer.Tick += NavigationRetryTickHandler;
                NavigationRetryTimer = timer;
            }
            try
            {
                timer.Start();
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        private void OnNavigationRetryTick()
        {
            if (!IsUiCallbackAlive() || NavigationRetryTimer == null) return;
            try
            {
                NavigationRetryTimer.Stop();
                if (WebView == null)
                {
                    StopNavigationRetryTimer();
                    return;
                }
                Navigate();
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        private void StartWebViewReadyTimeout()
        {
            if (!IsUiCallbackAlive()) return;
            try
            {
                if (WebViewReadyTimeoutTimer == null)
                {
                    WebViewReadyTimeoutTimer = new System.Windows.Forms.Timer { Interval = 10000 };
                    WebViewReadyTimeoutTimer.Tick += WebViewReadyTimeoutTickHandler;
                }
                WebViewReadyTimeoutTimer.Stop();
                WebViewReadyTimeoutTimer.Start();
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        private void StopNavigationRetryTimer()
        {
            if (NavigationRetryTimer == null) return;
            try { NavigationRetryTimer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
        }

        private void StopWebViewReadyTimeout()
        {
            if (WebViewReadyTimeoutTimer == null) return;
            try { WebViewReadyTimeoutTimer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
        }

        private void OnWebViewReadyTimeoutTick()
        {
            if (!IsUiCallbackAlive() || WebViewReadyTimeoutTimer == null) return;
            try { WebViewReadyTimeoutTimer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
            const string detail = "webview2-ready-timeout";
            FailureDetail = detail;
            BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, detail);
            ShowUnavailable(detail);
        }

        private void ShowUnavailable(string detail)
        {
            FailureDetail = detail;
            ShowUnavailable();
        }

        private void ShowUnavailable()
        {
            if (IsShutdownStarted() || IsDisposed || Disposing) return;
            StopNavigationRetryTimer();
            StopWebViewReadyTimeout();
            string detail = string.IsNullOrEmpty(FailureDetail) ? "host-unavailable" : FailureDetail;
            BridgeCodexHost.RecordHostStatus("WebView2", false, AppUrl, detail);
            DetachNavigationEvent();
            Control oldWebView = WebView;
            WebView = null;
            if (oldWebView != null)
            {
                try
                {
                    if (!oldWebView.IsDisposed) oldWebView.Dispose();
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
            }
            if (IsShutdownStarted() || IsDisposed || Disposing) return;
            try
            {
                Controls.Clear();
                TableLayoutPanel panel = new TableLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    BackColor = Color.FromArgb(16, 17, 19),
                    Padding = new Padding(32),
                    ColumnCount = 1,
                    RowCount = 4
                };
                panel.RowStyles.Add(new RowStyle(SizeType.Percent, 35F));
                panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                panel.RowStyles.Add(new RowStyle(SizeType.Percent, 65F));
                Label title = new Label
                {
                    Dock = DockStyle.Fill,
                    AutoSize = false,
                    TextAlign = ContentAlignment.BottomCenter,
                    ForeColor = Color.Gainsboro,
                    Font = new Font("Segoe UI", 18F, FontStyle.Bold),
                    Text = "Local Codex Bridge\r\nControl Center 暂时无法加载"
                };
                Label reason = new Label
                {
                    Dock = DockStyle.Fill,
                    AutoSize = false,
                    TextAlign = ContentAlignment.MiddleCenter,
                    ForeColor = Color.FromArgb(175, 185, 195),
                    Padding = new Padding(0, 14, 0, 8),
                    Text = "当前阶段：" + (detail ?? "host-unavailable") + "\r\n后台服务可以独立重试，诊断信息仍可用。"
                };
                FlowLayoutPanel actions = new FlowLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    AutoSize = true,
                    FlowDirection = FlowDirection.LeftToRight,
                    WrapContents = true,
                    Anchor = AnchorStyles.None
                };
                actions.Controls.Add(FallbackButton("重新加载界面", delegate { RecreateWebView(); }));
                actions.Controls.Add(FallbackButton("重新启动 Control Center Host", delegate { RestartControlCenter(); }));
                actions.Controls.Add(FallbackButton("复制诊断", delegate { try { Clipboard.SetText(Controller.Diagnostics()); } catch { } }));
                actions.Controls.Add(FallbackButton("打开日志", delegate { try { Controller.OpenLogs(); } catch { } }));
                actions.Controls.Add(FallbackButton("退出", delegate { CloseApplication(); }));
                panel.Controls.Add(title, 0, 0);
                panel.Controls.Add(reason, 0, 1);
                panel.Controls.Add(actions, 0, 2);
                Controls.Add(panel);
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        private Button FallbackButton(string text, Action action)
        {
            Button button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(120, 34) };
            button.Click += delegate
            {
                if (!IsUiCallbackAlive()) return;
                try { action(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
            };
            return button;
        }

        private void RecreateWebView()
        {
            if (!IsUiCallbackAlive() || WebViewType == null) return;
            try
            {
                Control old = WebView;
                DetachNavigationEvent();
                WebView = Activator.CreateInstance(WebViewType) as Control;
                if (WebView == null) throw new InvalidOperationException("WebView2 control could not be recreated");
                WebView.Dock = DockStyle.Fill;
                Controls.Clear();
                Controls.Add(WebView);
                EventInfo navigation = WebViewType.GetEvent("NavigationCompleted");
                if (navigation != null)
                {
                    Delegate handler = CreateNavigationCompletedHandler(navigation);
                    if (handler != null)
                    {
                        NavigationEvent = navigation;
                        NavigationCompletedHandler = handler;
                        navigation.AddEventHandler(WebView, handler);
                    }
                }
                EventInfo navigationStarting = WebViewType.GetEvent("NavigationStarting");
                if (navigationStarting != null)
                {
                    Delegate handler = CreateNavigationStartingHandler(navigationStarting);
                    if (handler != null)
                    {
                        NavigationStartingEvent = navigationStarting;
                        NavigationStartingHandler = handler;
                        navigationStarting.AddEventHandler(WebView, handler);
                    }
                }
                try { if (old != null && !old.IsDisposed) old.Dispose(); } catch (ObjectDisposedException) { }
                NavigationAttempts = 0;
                FailureDetail = "";
                BridgeCodexHost.TryBeginInvoke(this, InitializeWebView2);
            }
            catch (ObjectDisposedException)
            {
            }
            catch (InvalidOperationException)
            {
            }
        }

        private void RestartControlCenter()
        {
            if (!IsUiCallbackAlive()) return;
            Task.Factory.StartNew(delegate
            {
                try { Controller.Start(); } catch { }
            }).ContinueWith(delegate
            {
                BridgeCodexHost.TryBeginInvoke(this, delegate
                {
                    NavigationAttempts = 0;
                    FailureDetail = "";
                    RecreateWebView();
                });
            }, TaskScheduler.Default);
        }

        private bool IsShutdownStarted()
        {
            return Interlocked.CompareExchange(ref ShutdownStarted, 0, 0) != 0;
        }

        private bool IsUiCallbackAlive()
        {
            return !IsShutdownStarted() && BridgeCodexHost.IsUiUsable(this);
        }

        private void DetachNavigationEvent()
        {
            if (NavigationEvent != null && NavigationCompletedHandler != null && WebView != null)
            {
                try
                {
                    NavigationEvent.RemoveEventHandler(WebView, NavigationCompletedHandler);
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
            }
            NavigationEvent = null;
            NavigationCompletedHandler = null;
            if (NavigationStartingEvent != null && NavigationStartingHandler != null && WebView != null)
            {
                try
                {
                    NavigationStartingEvent.RemoveEventHandler(WebView, NavigationStartingHandler);
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
            }
            NavigationStartingEvent = null;
            NavigationStartingHandler = null;
            if (NewWindowEvent != null && NewWindowRequestedHandler != null && WebViewCore != null)
            {
                try
                {
                    NewWindowEvent.RemoveEventHandler(WebViewCore, NewWindowRequestedHandler);
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
            }
            if (WebMessageEvent != null && WebMessageReceivedHandler != null && WebViewCore != null)
            {
                try
                {
                    WebMessageEvent.RemoveEventHandler(WebViewCore, WebMessageReceivedHandler);
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
                catch
                {
                }
            }
            if (ProcessFailedEvent != null && ProcessFailedHandler != null && WebViewCore != null)
            {
                try
                {
                    ProcessFailedEvent.RemoveEventHandler(WebViewCore, ProcessFailedHandler);
                }
                catch (ObjectDisposedException)
                {
                }
                catch (InvalidOperationException)
                {
                }
                catch
                {
                }
            }
            WebViewCore = null;
            NewWindowEvent = null;
            NewWindowRequestedHandler = null;
            WebMessageEvent = null;
            WebMessageReceivedHandler = null;
            ProcessFailedEvent = null;
            ProcessFailedHandler = null;
        }

        private void BeginShutdown()
        {
            if (Interlocked.Exchange(ref ShutdownStarted, 1) != 0) return;
            if (ShownHandler != null)
            {
                try { Shown -= ShownHandler; } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
            }
            DetachNavigationEvent();
            Control webView = WebView;
            WebView = null;
            if (webView != null)
            {
                try { Controls.Remove(webView); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                try { if (!webView.IsDisposed) webView.Dispose(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
            }
            if (NavigationRetryTimer != null)
            {
                System.Windows.Forms.Timer timer = NavigationRetryTimer;
                NavigationRetryTimer = null;
                try { timer.Tick -= NavigationRetryTickHandler; } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                try { timer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                try { timer.Dispose(); } catch (ObjectDisposedException) { }
            }
            if (WebViewReadyTimeoutTimer != null)
            {
                System.Windows.Forms.Timer timer = WebViewReadyTimeoutTimer;
                WebViewReadyTimeoutTimer = null;
                try { timer.Tick -= WebViewReadyTimeoutTickHandler; } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                try { timer.Stop(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                try { timer.Dispose(); } catch (ObjectDisposedException) { }
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!AllowClose)
            {
                e.Cancel = true;
                try { if (!IsDisposed && !Disposing) Hide(); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { }
                return;
            }
            BeginShutdown();
            base.OnFormClosing(e);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            BeginShutdown();
            base.OnFormClosed(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) BeginShutdown();
            base.Dispose(disposing);
        }

        private BridgeCodexWebViewForm(bool selfTest)
        {
            AppUrl = "";
            Debug = false;
            WebViewType = null;
            ShownHandler = null;
            NavigationRetryTickHandler = null;
            Text = "Local Codex Bridge";
            MinimumSize = new Size(640, 420);
            Width = 980;
            Height = 720;
            WindowState = FormWindowState.Maximized;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
        }

        internal static int RunLifecycleSelfTestCode()
        {
            BridgeCodexWebViewForm form = new BridgeCodexWebViewForm(true);
            bool queued = false;
            try
            {
                if (form.WindowState != FormWindowState.Maximized) return 7;
                form.CreateControl();
                if (form.WindowState != FormWindowState.Maximized) return 8;
                if (!string.Equals(form.Text, "Local Codex Bridge", StringComparison.Ordinal)) return 6;
                form.WindowState = FormWindowState.Maximized;
                for (int cycle = 0; cycle < 5; cycle++)
                {
                    form.Show();
                    form.Close();
                    if (form.IsDisposed || form.Visible || form.WindowState != FormWindowState.Maximized) return 1;
                    form.Show();
                    if (!form.IsHandleCreated || form.WindowState != FormWindowState.Maximized) return 1;
                }
                Rectangle normalBounds = new Rectangle(Screen.PrimaryScreen.WorkingArea.Left + 20, Screen.PrimaryScreen.WorkingArea.Top + 20, 800, 560);
                form.WindowState = FormWindowState.Normal;
                form.StartPosition = FormStartPosition.Manual;
                form.Bounds = normalBounds;
                for (int cycle = 0; cycle < 5; cycle++)
                {
                    form.Show();
                    form.Close();
                    if (form.IsDisposed || form.Visible || form.WindowState != FormWindowState.Normal || form.Bounds != normalBounds) return 1;
                    form.Show();
                    if (!form.IsHandleCreated || form.WindowState != FormWindowState.Normal || form.Bounds != normalBounds) return 1;
                }
                queued = BridgeCodexHost.TryBeginInvoke(form, delegate { form.ShowUnavailable(); });
                if (!queued) return 2;
                form.CloseApplication();
                if (!form.IsDisposed) form.Dispose();
                Application.DoEvents();
                if (form.TryPostSelfTestCallback()) return 3;
                return 0;
            }
            catch (ObjectDisposedException)
            {
                return 4;
            }
            catch (InvalidOperationException)
            {
                return 5;
            }
            finally
            {
                try { if (!form.IsDisposed) form.Dispose(); } catch (ObjectDisposedException) { }
            }
        }

        private bool TryPostSelfTestCallback()
        {
            return BridgeCodexHost.TryBeginInvoke(this, delegate { });
        }
    }
}
