import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import util from "node:util";

import fg from "fast-glob";
import matter from "gray-matter";
import markdownIt from "markdown-it";
import markdownItFootnote from "markdown-it-footnote";
import nunjucks from "nunjucks";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import slugify from "slugify";
import { optimize } from "svgo";
import Image from "@11ty/eleventy-img";
import pluginRss from "@11ty/eleventy-plugin-rss";

import contentParser from "../../utils/transforms/contentParser.js";

const require = createRequire(import.meta.url);
const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const componentsDir = path.join(srcDir, "components");
const layoutsDir = path.join(componentsDir, "layouts");
const staticDir = path.join(rootDir, "static");
const now = new Date();

dayjs.extend(customParseFormat);

const markdown = markdownIt({
  html: true,
  breaks: false,
  linkify: true,
}).use(markdownItFootnote);

class PreprocessedLoader extends nunjucks.FileSystemLoader {
  getSource(name) {
    const source = super.getSource(name);
    if (source) {
      source.src = preprocessTemplate(source.src);
    }
    return source;
  }
}

export async function renderSite({ outDir }) {
  const normalizedOutDir = outDir.replace(/[\\/]$/, "");
  const globalData = loadGlobalData();
  const items = await loadItems(globalData);
  const collections = await buildCollections(items);
  const memo = new Map(items.map(item => [item.template.parsed.name, item]));
  const imageJobs = [];

  const env = createEnvironment({
    collections,
    globalData,
    imageJobs,
    memo,
    outDir: normalizedOutDir,
  });

  for (const item of items) {
    item.content = item.data.pagination
      ? ""
      : await renderContent(item, env, collections, globalData);
  }

  const pages = createRenderPages(items, collections, globalData, env);

  for (const page of pages) {
    await writeRenderedPage(page, env, collections, globalData, normalizedOutDir);
  }

  await Promise.all(imageJobs);
}

function loadGlobalData() {
  const data = {};
  for (const filePath of fg.sync("src/_data/*.{json,js}", { cwd: rootDir, absolute: true })) {
    const name = path.basename(filePath).replace(/\.(json|js)$/, "");
    if (filePath.endsWith(".json")) {
      data[name] = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else {
      delete require.cache[require.resolve(filePath)];
      data[name] = require(filePath);
    }
  }
  return data;
}

async function loadItems(globalData) {
  const files = await fg("src/**/*.{md,njk}", {
    cwd: rootDir,
    absolute: true,
    ignore: [
      "src/assets/**",
      "src/components/**",
      "src/_data/**",
      "src/**/*.11tydata.js",
      "src/**/*.og.njk",
    ],
  });

  const items = files.map(filePath => {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    const relativePath = normalizePath(path.relative(rootDir, filePath));
    const srcRelative = normalizePath(path.relative(srcDir, filePath));
    const fileSlug = getFileSlug(filePath);
    const templateName = path.basename(filePath, path.extname(filePath));
    const dirData = loadDirectoryData(path.dirname(filePath));
    const data = deepMerge({}, dirData, parsed.data);
    if (typeof data.tags === "string") {
      data.tags = [data.tags];
    }
    const date = getDate(data, filePath);

    const item = {
      inputPath: `./${relativePath}`,
      filePath,
      relativePath,
      srcRelative,
      fileSlug,
      date,
      rawContent: parsed.content,
      data,
      template: {
        parsed: {
          name: templateName,
        },
      },
    };

    item.page = {
      date,
      fileSlug,
      inputPath: item.inputPath,
      url: null,
    };
    item.data.page = item.page;
    item.url = computeUrl(item, globalData, {});
    item.page.url = item.url;

    return item;
  });

  return items;
}

function loadDirectoryData(directory) {
  const dataFile = path.join(directory, `${path.basename(directory)}.11tydata.js`);
  if (!fs.existsSync(dataFile)) {
    return {};
  }
  delete require.cache[require.resolve(dataFile)];
  return require(dataFile);
}

async function buildCollections(items) {
  const collectionApi = {
    getAll() {
      return items;
    },
    getFilteredByGlob(pattern) {
      return filterByGlob(items, pattern);
    },
    getFilteredByTag(tag) {
      return items.filter(item => item.data.tags?.includes(tag));
    },
  };

  const modules = {
    appearances: "./collections/appearances.js",
    channels: "./collections/channels.js",
    channelsAppearances: "./collections/channelsAppearances.js",
    calendar: "./collections/calendar.js",
    videos: "./collections/videos.js",
    workshops: "./collections/workshops.js",
    posts: "./collections/posts.js",
    emberPosts: "./collections/ember-posts.js",
    elixirPosts: "./collections/elixirPosts.js",
    rustPosts: "./collections/rustPosts.js",
    sveltePosts: "./collections/sveltePosts.js",
    travelPosts: "./collections/travelPosts.js",
    authors: "./collections/authors.js",
    authorsPostsPaged: "./collections/authorsPostsPaged.js",
    tags: "./collections/tags.js",
    tagsPostsPaged: "./collections/tagsPostsPaged.js",
    caseStudies: "./collections/caseStudies.js",
    caseStudiesFeatured: "./collections/caseStudiesFeatured.js",
    twios: "./collections/twios.js",
    memoized: "./collections/memoized.js",
  };

  const collections = { all: items };
  for (const [name, modulePath] of Object.entries(modules)) {
    collections[name] = require(path.join(rootDir, modulePath))(collectionApi);
  }
  return collections;
}

function createEnvironment({ collections, globalData, imageJobs, memo, outDir }) {
  const env = new nunjucks.Environment(new PreprocessedLoader([componentsDir, srcDir]), {
    autoescape: false,
    throwOnUndefined: false,
  });

  let activeItem = null;

  env.addGlobal("eleventy", { env: { runMode: "build" } });
  env.addGlobal("setActiveItem", item => {
    activeItem = item;
  });
  env.addGlobal(
    "__imageShortcode",
    (imgPath, alt = "", sizes = "100vw", loading = "lazy", className = "", sizesArray) =>
      renderImage({ imgPath, alt, sizes, loading, className, sizesArray, imageJobs, outDir })
  );
  env.addGlobal("__svgShortcode", svgPath => renderSvg(svgPath));
  env.addGlobal("inlineImage", imagePath => inlineImage(imagePath));
  env.addGlobal("copyrightYear", () => `${now.getFullYear()}`);
  env.addGlobal("turnstileSiteKey", () => process.env.CF_TURNSTILE_KEY || "");
  env.addGlobal("mastodonHandleUrl", handle => {
    const [user, server] = handle.split("@").filter(Boolean);
    return `https://${server}/@${user}`;
  });
  env.addGlobal("note", (type = "note", title = null, content = "") =>
    renderNote(content, type, title)
  );
  env.addGlobal("jsonLdScript", schemaMeta => {
    return `<script type="application/ld+json">${JSON.stringify(schemaMeta)}</script>`;
  });

  env.addFilter("monthDayYear", date => dayjs(date).format("MMMM D, YYYY"));
  env.addFilter("htmlDate", date => dayjs(date).format());
  env.addFilter("console", value => util.inspect(value));
  env.addFilter("findBySlug", slug => memo.get(slug) || null);
  env.addFilter(
    "findByCollectionSlug",
    (collection, slug) => collection?.find(item => item.fileSlug === slug) || null
  );
  env.addFilter(
    "filterByCollectionTag",
    (collection, tag) => collection?.filter(item => item.data.tags?.includes(tag)) || []
  );
  env.addFilter("formatTagline", tagline =>
    tagline.split("</p>")[0].replace(/<\/?[^>]+(>|$)/g, "")
  );
  env.addFilter("stripHTML", value => String(value || "").replace(/(<([^>]+)>)/gi, ""));
  env.addFilter("markdown", value => (value ? markdown.render(value) : ""));
  env.addFilter("filterByAttribute", (array, attribute, value) =>
    (array || []).filter(element => element.data?.[attribute] === value)
  );
  env.addFilter("limit", (array, limit) => (array || []).slice(0, limit));
  env.addFilter("getMorePosts", (array, post) =>
    (array || [])
      .filter(element => element.inputPath !== post.inputPath)
      .map(element => element.fileSlug)
  );
  env.addFilter("getCollectionKeys", collection => Object.keys(collection || {}));
  env.addFilter("dateToRfc3339", pluginRss.dateToRfc3339);
  env.addFilter("dateToRfc822", pluginRss.dateToRfc822);
  env.addFilter("urlExists", (url, collection) =>
    Boolean(collection?.find(({ page }) => page.url === url))
  );
  env.addFilter("upcoming", collection =>
    (collection || [])
      .filter(item => Date.parse(item.startDate) > new Date())
      .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))
  );
  env.addFilter("getAuthor", (authors, handle) =>
    authors.find(author => author.fileSlug === handle)
  );
  env.addFilter("slug", value => slugify(String(value || ""), { lower: true, strict: true }));
  env.addFilter("url", value => encodeURI(value));
  env.addFilter("absoluteUrl", (url, base) => new URL(url, base).toString());
  env.addFilter("htmlToAbsoluteUrls", (html, base) =>
    String(html || "").replace(/(href|src)="\/([^"]*)"/g, `$1="${new URL("/", base).origin}/$2"`)
  );
  env.addFilter("getNewestCollectionItemDate", collection => collection?.[0]?.date || now);
  env.addFilter("getPreviousCollectionItem", collection =>
    adjacentCollectionItem(collection, activeItem, -1)
  );
  env.addFilter("getNextCollectionItem", collection =>
    adjacentCollectionItem(collection, activeItem, 1)
  );
  env.addFilter("getCollectionItem", (collection, page) =>
    (collection || []).find(item => item.inputPath === page?.inputPath || item.url === page?.url)
  );
  env.addFilter("nl2br", value => String(value || "").replace(/\n/g, "<br>\n"));
  env.addFilter("eleventyNavigation", collection =>
    (collection || [])
      .filter(item => item.data.eleventyNavigation && item.url)
      .map(item => ({ ...item.data.eleventyNavigation, url: item.url }))
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  );

  for (const [key, value] of Object.entries(globalData)) {
    env.addGlobal(key, value);
  }
  env.addGlobal("collections", collections);

  return env;
}

async function renderContent(item, env, collections, globalData, extraData = {}, url = item.url) {
  const data = createTemplateData(item, collections, globalData, extraData);
  data.page = { ...data.page, url };
  env.getGlobal("setActiveItem")(item);
  const rendered = env.renderString(preprocessMarkdownNotes(item.rawContent, env, data), data);
  if (item.filePath.endsWith(".md")) {
    return markdown.render(rendered);
  }
  return rendered;
}

function createRenderPages(items, collections, globalData, env) {
  const pages = [];
  for (const item of items) {
    if (item.srcRelative === "blog.njk") {
      pages.push(...createBlogPages(item, collections, globalData, env));
      continue;
    }
    if (item.srcRelative === "author.njk") {
      pages.push(
        ...createPagedPages(
          item,
          collections.authorsPostsPaged,
          "paged",
          collections,
          globalData,
          env
        )
      );
      continue;
    }
    if (item.srcRelative === "tag.njk") {
      pages.push(
        ...createPagedPages(item, collections.tagsPostsPaged, "paged", collections, globalData, env)
      );
      continue;
    }
    if (item.url) {
      pages.push({ item, url: item.url, extraData: {} });
    }
  }
  return pages;
}

function createBlogPages(item, collections, globalData, env) {
  const posts = collections.posts.slice(1);
  const size = item.data.pagination.size;
  const chunks = chunk(posts, size);
  return chunks.map((postsChunk, index) => {
    const url = normalizeUrl(index === 0 ? "/blog/" : `/blog/page/${index + 1}/`);
    const href = {
      previous: index > 0 ? normalizeUrl(index === 1 ? "/blog/" : `/blog/page/${index}/`) : null,
      next: index < chunks.length - 1 ? normalizeUrl(`/blog/page/${index + 2}/`) : null,
    };
    const pagination = {
      items: postsChunk,
      pageNumber: index,
      href,
    };
    const extraData = { posts: postsChunk, pagination };
    applyComputedData(item, extraData, collections, globalData, env);
    return { item, url, extraData };
  });
}

function createPagedPages(item, pagedItems, alias, collections, globalData, env) {
  return pagedItems.map(paged => {
    const extraData = { [alias]: paged };
    applyComputedData(item, extraData, collections, globalData, env);
    const url = renderPermalink(item.data.permalink, item, collections, globalData, env, extraData);
    return { item, url, extraData };
  });
}

async function writeRenderedPage(page, env, collections, globalData, outDir) {
  const item = page.item;
  env.getGlobal("setActiveItem")(item);
  const content = await renderContent(item, env, collections, globalData, page.extraData, page.url);
  let data = createTemplateData(item, collections, globalData, page.extraData);
  data.page = { ...data.page, url: page.url };
  data = deepMerge({}, collectLayoutData(data.layout), data);
  let rendered = await renderWithLayouts(content, data, env);

  const outputPath = outputPathForUrl(outDir, page.url);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (outputPath.endsWith(".html")) {
    rendered = await contentParser(rendered, outputPath);
  }
  fs.writeFileSync(outputPath, rendered);
}

async function renderWithLayouts(content, data, env) {
  let output = content;
  let layout = data.layout;
  const seen = new Set();

  while (layout) {
    if (seen.has(layout)) {
      throw new Error(`Circular layout reference: ${layout}`);
    }
    seen.add(layout);

    const layoutPath = layoutFilePath(layout);
    const parsed = matter(fs.readFileSync(layoutPath, "utf8"));
    const layoutData = deepMerge({}, parsed.data, data, { content: output });
    output = env.renderString(preprocessTemplate(parsed.content), layoutData);
    layout = parsed.data.layout;
    data = deepMerge({}, layoutData, { layout });
  }

  return output;
}

function createTemplateData(item, collections, globalData, extraData = {}) {
  return deepMerge(
    {},
    globalData,
    item.data,
    {
      collections,
      content: item.content || "",
      page: { ...item.page, url: item.url },
      permalink: item.data.permalink,
    },
    extraData
  );
}

function collectLayoutData(layout) {
  const data = {};
  const seen = new Set();
  let current = layout;
  while (current) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const layoutPath = layoutFilePath(current);
    if (!fs.existsSync(layoutPath)) {
      break;
    }
    const parsed = matter(fs.readFileSync(layoutPath, "utf8"));
    deepMerge(data, parsed.data);
    current = parsed.data.layout;
  }
  return data;
}

function applyComputedData(item, extraData, collections, globalData, env) {
  const computed = item.data.eleventyComputed || {};
  for (const [key, value] of Object.entries(computed)) {
    if (typeof value === "string") {
      extraData[key] = env
        .renderString(value, createTemplateData(item, collections, globalData, extraData))
        .trim();
    }
  }
}

function computeUrl(item, globalData, extraData) {
  if (item.data.permalink === false) {
    return false;
  }
  if (
    item.srcRelative === "blog.njk" ||
    item.srcRelative === "author.njk" ||
    item.srcRelative === "tag.njk"
  ) {
    return null;
  }
  if (item.data.eleventyComputed?.permalink) {
    return normalizeUrl(computeKnownPermalink(item, extraData));
  }
  if (typeof item.data.permalink === "string") {
    return normalizeUrl(item.data.permalink);
  }
  return normalizeUrl(defaultUrl(item.srcRelative));
}

function computeKnownPermalink(item) {
  if (item.srcRelative.startsWith("posts/")) {
    const [, year, month, day, slug] = path
      .basename(item.filePath, path.extname(item.filePath))
      .match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
    return `/blog/${year}/${month}/${day}/${slug}/`;
  }
  if (item.srcRelative.startsWith("workshops/")) {
    return `/services/workshops/${item.page.fileSlug}/`;
  }
  if (item.srcRelative.startsWith("twios/")) {
    const [, year, month, day] = path
      .basename(item.filePath, path.extname(item.filePath))
      .match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return `/this-week-in-open-source/${year}/${month}/${day}/`;
  }
  return item.data.permalink;
}

function renderPermalink(template, item, collections, globalData, env, extraData) {
  return normalizeUrl(
    env.renderString(template, createTemplateData(item, collections, globalData, extraData)).trim()
  );
}

function defaultUrl(srcRelative) {
  const parsed = path.posix.parse(srcRelative.replace(/\\/g, "/"));
  if (parsed.name === "index" && parsed.dir === "") {
    return "/";
  }
  const withoutExtension = path.posix.join(parsed.dir, parsed.name);
  if (withoutExtension === "404") {
    return "/404/";
  }
  return `/${withoutExtension}/`;
}

function normalizeUrl(url) {
  if (url === false || url === null) {
    return url;
  }
  const [pathname, hash] = String(url).split("#");
  if (!pathname.endsWith("/") && path.extname(pathname)) {
    const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return normalizedPathname.replace(/\/{2,}/g, "/") + (hash ? `#${hash}` : "");
  }
  return (pathname.replace(/\/{2,}/g, "/").replace(/\/?$/, "/") || "/") + (hash ? `#${hash}` : "");
}

function outputPathForUrl(outDir, url) {
  const cleanUrl = url.split("#")[0];
  if (cleanUrl === "/404.html") {
    return path.join(outDir, "404.html");
  }
  if (!cleanUrl.endsWith("/") && path.extname(cleanUrl)) {
    return path.join(outDir, cleanUrl.replace(/^\//, ""));
  }
  return path.join(outDir, cleanUrl.replace(/^\//, ""), "index.html");
}

function layoutFilePath(layout) {
  return path.join(layoutsDir, layout.endsWith(".njk") ? layout : `${layout}.njk`);
}

function getFileSlug(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

function getDate(data, filePath) {
  if (data.date) {
    return new Date(data.date);
  }
  const match = path.basename(filePath).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  }
  return fs.statSync(filePath).mtime;
}

function filterByGlob(items, pattern) {
  const normalized = normalizePath(pattern).replace(/^\.\//, "");
  if (normalized.includes("/**/*")) {
    const prefix = normalized.replace("/**/*", "");
    return items.filter(item => item.relativePath.startsWith(prefix));
  }
  if (normalized.endsWith("/*.md")) {
    const prefix = normalized.replace("/*.md", "");
    return items.filter(
      item => item.relativePath.startsWith(`${prefix}/`) && item.relativePath.endsWith(".md")
    );
  }
  return [];
}

function preprocessTemplate(source) {
  return source
    .replace(/\{%-?\s*setAsync[\s\S]*?\{%-?\s*endsetAsync\s*-?%\}/g, "")
    .replace(/autoOg and eleventy\.env\.runMode === "build"/g, "false")
    .replace(/\{%-?\s*elseif\b/g, "{% elif")
    .replace(/\{%-?\s*jsonLdScript\s+([^%]+?)\s*-?%\}/g, "{{ jsonLdScript($1) | safe }}")
    .replace(/\{%-?\s*image\s+([^%]+?)\s*-?%\}/g, "{{ __imageShortcode($1) | safe }}")
    .replace(/\{%-?\s*svg\s+([^%]+?)\s*-?%\}/g, "{{ __svgShortcode($1) | safe }}")
    .replace(/\{%-?\s*(inlineImage|mastodonHandleUrl)\s+([^%]+?)\s*-?%\}/g, "{{ $1($2) | safe }}")
    .replace(/\{%-?\s*(copyrightYear|turnstileSiteKey)\s*-?%\}/g, "{{ $1() | safe }}");
}

function preprocessMarkdownNotes(source, env, data) {
  return preprocessTemplate(source).replace(
    /\{%-?\s*note\s+([^%]+?)\s*-?%\}([\s\S]*?)\{%-?\s*endnote\s*-?%\}/g,
    (_, argsSource, content) => {
      const args = parseNoteArgs(argsSource);
      const renderedContent = markdown.render(env.renderString(content, data));
      return renderNote(renderedContent, ...args);
    }
  );
}

function parseNoteArgs(source) {
  return source
    .split(",")
    .map(part => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function renderImage({ imgPath, alt, sizes, loading, className, sizesArray, imageJobs, outDir }) {
  const url = path.join(staticDir, imgPath);
  const fileType = path.extname(imgPath).replace(".", "");
  const directory = path.dirname(imgPath).replace(/\\/g, "/");
  const formats = ["webp", ...(fileType !== "gif" ? [fileType] : [])];
  const widths = sizesArray || [720, 1024, 1440];
  const options = {
    svgShortCircuit: true,
    widths,
    formats,
    urlPath: directory,
    outputDir: path.join(outDir, directory),
    filenameFormat: function (_id, _src, width, format) {
      const extension = path.extname(imgPath);
      const name = path.basename(imgPath, extension);
      return `${name}@${width}.${format}`;
    },
  };
  const stats = Image.statsSync(url, options);
  imageJobs.push(Image(url, options));
  return Image.generateHTML(stats, {
    class: className,
    alt,
    sizes: sizes || "100vw",
    loading,
  });
}

function inlineImage(imagePath) {
  let extension = path.extname(imagePath).slice(1);
  const fullImagePath = path.join(staticDir, imagePath);
  const base64Image = fs.readFileSync(fullImagePath, "base64");
  if (extension === "svg") {
    extension = "svg+xml";
  }
  if (extension === "jpg") {
    extension = "jpeg";
  }
  return `data:image/${extension};base64,${base64Image}`;
}

function renderNote(content, type = "note", title = null) {
  const icons = {
    warning:
      '<svg width="20" height="20" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M256 0c14.7 0 28.2 8.1 35.2 21l216 400c6.7 12.4 6.4 27.4-.8 39.5S486.1 480 472 480H40c-14.1 0-27.2-7.4-34.4-19.5s-7.5-27.1-.8-39.5l216-400c7-12.9 20.5-21 35.2-21m0 352a32 32 0 1 0 0 64a32 32 0 1 0 0-64m0-192c-18.2 0-32.7 15.5-31.4 33.7l7.4 104c.9 12.5 11.4 22.3 23.9 22.3c12.6 0 23-9.7 23.9-22.3l7.4-104c1.3-18.2-13.1-33.7-31.4-33.7z"/></svg>',
    tip: '<svg width="20" height="20" viewBox="0 -56 576 576" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M309.5-18.9c-4.1-8-12.4-13.1-21.4-13.1s-17.3 5.1-21.4 13.1l-73.6 144.2l-159.9 25.4c-8.9 1.4-16.3 7.7-19.1 16.3s-.5 18 5.8 24.4l114.4 114.5l-25.2 159.9c-1.4 8.9 2.3 17.9 9.6 23.2s16.9 6.1 25 2l144.4-73.4L432.4 491c8 4.1 17.7 3.3 25-2s11-14.2 9.6-23.2l-25.3-159.9l114.4-114.5c6.4-6.4 8.6-15.8 5.8-24.4s-10.1-14.9-19.1-16.3L383 125.3z"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M256 512a256 256 0 1 0 0-512a256 256 0 1 0 0 512m-32-352a32 32 0 1 1 64 0a32 32 0 1 1-64 0m-8 64h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24h-80c-13.3 0-24-10.7-24-24s10.7-24 24-24h24v-64h-24c-13.3 0-24-10.7-24-24s10.7-24 24-24"/></svg>',
  };
  const icon = icons[type] || icons.info;
  return `<div class="note note--${type}" role="${type === "warning" ? "alert" : "note"}">
    <div class="note__header">
      <div class="note__icon">${icon}</div>
      ${title ? `<h4 class="note__title">${title}</h4>` : ""}
    </div>
    <div class="note__content">${content}</div>
  </div>`;
}

function adjacentCollectionItem(collection, activeItem, offset) {
  if (!collection || !activeItem) {
    return null;
  }
  const index = collection.findIndex(item => item.inputPath === activeItem.inputPath);
  return index >= 0 ? collection[index + offset] || null : null;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (isPlainObject(value)) {
        target[key] = deepMerge(isPlainObject(target[key]) ? target[key] : {}, value);
      } else {
        target[key] = value;
      }
    }
  }
  return target;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function renderSvg(svgPath) {
  const svgData = fs.readFileSync(path.join(staticDir, "assets/images", svgPath), "utf8");
  const response = optimize(svgData, {
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: {
            removeViewBox: false,
          },
        },
      },
    ],
  });
  return response.data.replace("<svg", '<svg focusable="false" role="presentation"');
}

// Keep this module importable from ad-hoc validation scripts on Windows.
export const moduleUrl = pathToFileURL(import.meta.url).href;
