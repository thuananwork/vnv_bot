using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace VNVBotLauncher
{
    class Program
    {
        private static Process nodeProcess = null;

        [STAThread]
        static void Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.Title = "VNV Bot V2 - Trình Khởi Động Trưởng Vùng";

            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string actualAppDir = FindAppRootWithSrc(appDir);
            if (!string.IsNullOrEmpty(actualAppDir))
            {
                appDir = actualAppDir;
            }
            Directory.SetCurrentDirectory(appDir);

            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("=================================================");
            Console.WriteLine("    VNV BOT V2 - HỆ THỐNG QUẢN LÝ SỨ GIẢ        ");
            Console.WriteLine("=================================================");
            Console.ResetColor();

            // 1. Kiểm tra Node.js
            Console.WriteLine("[1/3] Đang kiểm tra môi trường Node.js...");
            string nodeExecutable = FindNodeExecutable(appDir);
            if (string.IsNullOrEmpty(nodeExecutable))
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("  [!] Máy tính chưa cài đặt Node.js runtime.");
                Console.WriteLine("  [i] Đang tự động tải Node.js portable runtime về máy (chỉ tải 1 lần duy nhất)...");
                Console.ResetColor();

                bool downloaded = AutoDownloadNode(appDir);
                if (downloaded)
                {
                    nodeExecutable = FindNodeExecutable(appDir);
                }

                if (string.IsNullOrEmpty(nodeExecutable))
                {
                    DialogResult res = MessageBox.Show(
                        "Không thể tự động tải Node.js runtime do lỗi mạng.\n\nBạn có muốn mở trang web https://nodejs.org để tải bản cài đặt không?",
                        "VNV Bot - Cần cài đặt Node.js",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning
                    );
                    if (res == DialogResult.Yes)
                    {
                        Process.Start("https://nodejs.org");
                    }
                    return;
                }
            }
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("  ✓ Node.js đã sẵn sàng: " + nodeExecutable);
            Console.ResetColor();

            // 2. Khởi chạy máy chủ VNV Bot
            Console.WriteLine("[2/3] Đang khởi động máy chủ VNV Bot...");
            string entryPoint = Path.Combine(appDir, "src", "index.js");
            if (!File.Exists(entryPoint))
            {
                string msg = "Không tìm thấy thư mục 'src' chứa mã nguồn của Bot!\n\n" +
                             "Đường dẫn hiện tại: " + appDir + "\n\n" +
                             "Nguyên nhân thường gặp:\n" +
                             "1. Bạn kéo riêng file VNV-Bot.exe ra ngoài mà không mang theo toàn bộ thư mục (src, config, node_modules...).\n" +
                             "2. Hoặc bạn mở trực tiếp trong file .ZIP mà CHƯA bấm 'Extract All' (Giải nén tất cả).\n\n" +
                             "👉 Cách xử lý:\n" +
                             "- Mở thư mục 'VNV-Bot-v2.0.0' (thư mục sau khi đã giải nén).\n" +
                             "- Chạy file VNV-Bot.exe ở BÊN TRONG thư mục đó.\n" +
                             "- Nếu muốn tạo biểu tượng ngoài Desktop: Chuột phải vào VNV-Bot.exe -> chọn 'Show more options' -> 'Send to' -> 'Desktop (create shortcut)'.";

                MessageBox.Show(msg, "Lỗi Khởi Động VNV Bot", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            // Tự động giải phóng cổng 3000 nếu có tiến trình cũ chiếm dụng
            FreePort3000IfOccupied();

            // Đăng ký dọn dẹp khi thoát
            AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
            Console.CancelKeyPress += (s, e) => {
                CleanupProcess();
            };

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodeExecutable,
                Arguments = "src/index.js",
                WorkingDirectory = appDir,
                UseShellExecute = false,
                RedirectStandardOutput = false,
                RedirectStandardError = false,
                CreateNoWindow = false
            };

            try
            {
                nodeProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Không thể khởi động tiến trình Node:\n" + ex.Message, "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("\nỨng dụng đang chạy tại: http://localhost:3000/#login");
            Console.WriteLine("Mẹo: Đóng tab trình duyệt web thì Bot sẽ tự động tắt hoàn toàn (không chạy ngầm).");
            Console.ResetColor();

            if (nodeProcess != null)
            {
                nodeProcess.WaitForExit();
                if (nodeProcess.ExitCode != 0)
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("\n=================================================");
                    Console.WriteLine("  [!] Tiến trình Bot đã dừng với mã lỗi: " + nodeProcess.ExitCode);
                    Console.WriteLine("=================================================");
                    Console.ResetColor();
                    Console.WriteLine("Nhấn phím bất kỳ để đóng cửa sổ...");
                    try { Console.ReadKey(); } catch { }
                }
            }
        }

        private static string FindAppRootWithSrc(string currentDir)
        {
            try
            {
                // 1. Kiểm tra ngay tại currentDir
                if (File.Exists(Path.Combine(currentDir, "src", "index.js")))
                {
                    return currentDir;
                }

                // 2. Kiểm tra các thư mục con phổ biến
                string[] knownSubDirs = new string[] { "VNV-Bot-v2.0.0", "VNV-Bot-v2", "vnv_bot", "VNV-Bot", "dist" };
                foreach (string sub in knownSubDirs)
                {
                    string cand = Path.Combine(currentDir, sub, "src", "index.js");
                    if (File.Exists(cand)) return Path.Combine(currentDir, sub);
                }

                // 3. Quét tất cả thư mục con cấp 1
                if (Directory.Exists(currentDir))
                {
                    foreach (string d in Directory.GetDirectories(currentDir))
                    {
                        string cand = Path.Combine(d, "src", "index.js");
                        if (File.Exists(cand)) return d;
                    }
                }

                // 4. Kiểm tra thư mục cha (nếu chạy từ bin/ hoặc thư mục con khác)
                string parent = Path.GetDirectoryName(currentDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                if (!string.IsNullOrEmpty(parent) && Directory.Exists(parent))
                {
                    string candParent = Path.Combine(parent, "src", "index.js");
                    if (File.Exists(candParent)) return parent;

                    foreach (string sub in knownSubDirs)
                    {
                        string candSub = Path.Combine(parent, sub, "src", "index.js");
                        if (File.Exists(candSub)) return Path.Combine(parent, sub);
                    }
                }
            }
            catch { }
            return null;
        }

        private static bool IsValidNodeExecutable(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return false;
            try
            {
                FileInfo fi = new FileInfo(path);
                // node.exe chuẩn có dung lượng > 20MB, loại bỏ các file bị giải nén lỗi hoặc 0 bytes
                if (fi.Length < 10000000) return false;

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = path,
                    Arguments = "-v",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                using (Process p = Process.Start(psi))
                {
                    if (p != null && p.WaitForExit(3000))
                    {
                        return p.ExitCode == 0;
                    }
                }
            }
            catch { }
            return false;
        }

        private static string FindNodeExecutable(string appDir)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string[] localPaths = new string[] {
                Path.Combine(appDir, "bin", "node.exe"),
                Path.Combine(baseDir, "bin", "node.exe"),
                Path.Combine(appDir, "node.exe"),
                Path.Combine(baseDir, "node.exe"),
                Path.Combine(appDir, "VNV-Bot-v2.0.0", "bin", "node.exe"),
                Path.Combine(baseDir, "VNV-Bot-v2.0.0", "bin", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                Path.Combine(appDir, "..", "node.exe")
            };
            foreach (string p in localPaths)
            {
                if (IsValidNodeExecutable(p)) return p;
            }
            if (IsSystemNodeInstalled()) return "node";
            return null;
        }

        private static bool IsSystemNodeInstalled()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "-v",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit(3000);
                    return p.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool AutoDownloadNode(string appDir)
        {
            try
            {
                string binDir = Path.Combine(appDir, "bin");
                if (!Directory.Exists(binDir)) Directory.CreateDirectory(binDir);
                string targetFile = Path.Combine(binDir, "node.exe");

                // URL tải node.exe win-x64 portable chính thức từ nodejs.org (Đồng bộ chuẩn với sqlite3 native)
                string nodeUrl = "https://nodejs.org/dist/v24.15.0/win-x64/node.exe";

                using (WebClient client = new WebClient())
                {
                    ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
                    int lastPct = -1;
                    client.DownloadProgressChanged += (s, e) => {
                        int pct = e.ProgressPercentage;
                        if (pct % 10 == 0 && pct != lastPct) {
                            lastPct = pct;
                            Console.Write("\r  Đang tải Node.js: " + pct + "% [" + (e.BytesReceived / 1024 / 1024) + "MB / " + (e.TotalBytesToReceive / 1024 / 1024) + "MB]...");
                        }
                    };
                    
                    AutoResetEvent done = new AutoResetEvent(false);
                    bool ok = false;
                    client.DownloadFileCompleted += (s, e) => {
                        if (e.Error == null && !e.Cancelled) ok = true;
                        done.Set();
                    };

                    client.DownloadFileAsync(new Uri(nodeUrl), targetFile);
                    done.WaitOne();
                    if (ok && File.Exists(targetFile))
                    {
                        Console.WriteLine("\n  ✓ Tải Node.js thành công!");
                        return true;
                    }
                    return false;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("\n  ❌ Lỗi tải tự động: " + ex.Message);
                return false;
            }
        }

        private static void FreePort3000IfOccupied()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c for /f \"tokens=5\" %a in ('netstat -ano -p tcp ^| findstr :3000 ^| findstr LISTENING 2^>nul') do taskkill /f /pid %a >nul 2>nul",
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(2000);
                }
            }
            catch { }
        }

        private static void OnProcessExit(object sender, EventArgs e)
        {
            CleanupProcess();
        }

        private static void CleanupProcess()
        {
            if (nodeProcess != null && !nodeProcess.HasExited)
            {
                try
                {
                    nodeProcess.Kill();
                }
                catch { }
            }
        }
    }
}
