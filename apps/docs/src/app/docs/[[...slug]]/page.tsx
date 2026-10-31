import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { source } from "@/lib/source";

const SITE_URL = "https://bromso.github.io/figma-plugin-template";
const REPO_URL = "https://github.com/bromso/figma-plugin-template";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const slug = params.slug?.join("/") || "";
  const url = `${SITE_URL}/docs/${slug}`;

  // JSON-LD structured data — all values are static/trusted (from MDX frontmatter)
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.data.title,
    description: page.data.description,
    url,
    image: `${SITE_URL}/figma-plugi-template.webp`,
    publisher: {
      "@type": "Organization",
      name: "Figma Plugin Template",
      url: REPO_URL,
    },
    isPartOf: {
      "@type": "WebSite",
      name: "Figma Plugin Template Docs",
      url: SITE_URL,
    },
  });

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD from trusted MDX frontmatter */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <DocsPage
        toc={page.data.toc}
        tableOfContent={{ style: "normal" }}
        breadcrumb={{ enabled: true }}
        footer={{ enabled: true }}
      >
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <div className="flex flex-row items-center gap-2">
          <EditOnGitHub href={`${REPO_URL}/blob/master/apps/docs/content/docs/${page.path}`} />
        </div>
        <DocsBody>
          <MDX components={getMDXComponents()} />
        </DocsBody>
      </DocsPage>
    </>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const slug = params.slug?.join("/") || "";
  const url = `${SITE_URL}/docs/${slug}`;

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: url },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url,
      siteName: "Figma Plugin Template",
      type: "article",
      images: [
        { url: "/figma-plugi-template.webp", width: 1200, height: 630, alt: page.data.title },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
      images: ["/figma-plugi-template.webp"],
    },
  };
}
