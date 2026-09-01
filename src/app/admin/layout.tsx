import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './admin.css';

export const metadata: Metadata = {
  title: 'CollectTT Admin',
  description: 'CollectTT operations and moderation console.',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}

