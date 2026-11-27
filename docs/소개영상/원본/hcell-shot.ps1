# 엑셀 파일을 한셀 뷰어로 열어 그 창 하나만 갈무리한다(PrintWindow). 키 입력·마우스 입력은 어느 창에도 보내지 않는다.
# 다른 작업자가 한셀 뷰어를 쓰고 있을 수 있으니 창은 **내 파일 이름이 든 제목**으로만 찾고, 다 찍으면 그 창에만 닫기(WM_CLOSE)를 보낸다.
# 실행: powershell -File hcell-shot.ps1 -Xlsx <파일> -Out <png> [-W 2880 -H 1700]
# 저장은 표 칸 부분(CropX·CropY·CropW·CropH)만 한다 — 창 위쪽(제목 줄·도구 모음)은 PrintWindow 가 제대로 그리지 못해
# 그 자리에 뒤에 있던 다른 창이 비쳐 찍혔다(2026-11-27 첫 시도, 그 그림은 바로 지웠다). 잘라 내기 전의 통그림은 파일로 남기지 않는다.
param([Parameter(Mandatory)][string]$Xlsx, [Parameter(Mandatory)][string]$Out, [int]$W = 2880, [int]$H = 1700,
      [int]$CropX = 0, [int]$CropY = 128, [int]$CropW = 2258, [int]$CropH = 1270)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class HW {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static List<IntPtr> Find(string part) {
    var o = new List<IntPtr>();
    EnumWindows((h, p) => { if (IsWindowVisible(h)) { var s = new StringBuilder(512); GetWindowText(h, s, 512); if (s.ToString().Contains(part)) o.Add(h); } return true; }, IntPtr.Zero);
    return o;
  }
}
"@
[void][HW]::SetProcessDPIAware()
$exe = "C:\Program Files (x86)\Hnc\Office 2024 Viewer\HOffice130\Bin\HCellViewer.exe"
$name = [IO.Path]::GetFileName($Xlsx)
if ([HW]::Find($name).Count) { throw "같은 이름의 창이 이미 열려 있다: $name" }
Start-Process -FilePath $exe -ArgumentList ('"' + (Resolve-Path $Xlsx).Path + '"') | Out-Null
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 120 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; $l = [HW]::Find($name); if ($l.Count) { $h = $l[0] } }
if ($h -eq [IntPtr]::Zero) { throw "창을 찾지 못했다: $name" }
[void][HW]::ShowWindow($h, 9)                                   # SW_RESTORE (최대화돼 있으면 풀기)
[void][HW]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, $W, $H, 0x0014)   # SWP_NOZORDER|SWP_NOACTIVATE — 크기만
Start-Sleep -Seconds 4
$r = New-Object HW+RECT; [void][HW]::GetWindowRect($h, [ref]$r)
$bw = $r.R - $r.L; $bh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $bw, $bh
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
$ok = [HW]::PrintWindow($h, $dc, 2)                             # PW_RENDERFULLCONTENT
$g.ReleaseHdc($dc); $g.Dispose()
$crop = $bmp.Clone((New-Object System.Drawing.Rectangle $CropX, $CropY, $CropW, $CropH), $bmp.PixelFormat); $bmp.Dispose()
$crop.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $crop.Dispose()
[void][HW]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)   # WM_CLOSE — 내 창만
Start-Sleep -Milliseconds 800
"shot $name ${bw}x${bh} printwindow=$ok closed=$(-not [HW]::Find($name).Count)"
