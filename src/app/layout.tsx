import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "오륙도인생후반전지원센터 | 교육 프로그램 신청",
  description:
    "50~60대 신중년을 위한 오륙도인생후반전지원센터 교육 프로그램 신청 반응형 웹 프로토타입입니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#123f36",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
