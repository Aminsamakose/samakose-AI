import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const DIR = path.join(process.cwd(), 'content', 'resources');
export type Article = { slug: string; title: string; summary: string; date: string; author: string; body: string };

/** Reads published articles from content/resources. Add a Markdown file with front matter to publish; set status: draft to hold one back. */
export function listArticles(): Article[] {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).map((f) => {
    const { data, content } = matter(fs.readFileSync(path.join(DIR, f), 'utf8'));
    return { slug: f.replace(/\.md$/, ''), title: String(data.title ?? f), summary: String(data.summary ?? ''), date: data.date ? new Date(data.date).toISOString().slice(0, 10) : '', author: String(data.author ?? 'Samakose'), body: content, status: String(data.status ?? 'draft') };
  }).filter((a) => a.status === 'published').map(({ status: _s, ...a }) => a).sort((a, b) => b.date.localeCompare(a.date));
}
export const getArticle = (slug: string) => listArticles().find((a) => a.slug === slug) ?? null;
