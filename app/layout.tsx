import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'VYB-SEO: open-source AI SEO agent',
  description:
    'An open-source AI SEO agent for Markdown blogs. It researches keywords, writes and refreshes posts behind a quality gate, and opens pull requests. Run it on Vercel with your own key, or in Claude Code on your Claude subscription.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} antialiased`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
