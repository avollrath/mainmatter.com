# Astro Migration Notes

## Inventory

- Package manager: `pnpm@9.15.4` from `packageManager` and `pnpm-lock.yaml`.
- Current build target: static site in `dist`, deployed by Netlify via `pnpm build`.
- Eleventy config: `.eleventy.js`, input `src`, includes `src/components`, layouts `src/components/layouts`, output `dist`.
- Static assets: `static` passthrough copied to site root. CSS is compiled from `src/assets/css/app.scss` to `/assets/css/app.css`; JS is bundled from `src/assets/js/app.js` with Rollup to `/assets/js/app.js`.
- Layouts: `base`, `page`, `post`, `twios-post`, `case-study`, `workshop`.
- Includes/components: reusable Nunjucks components in `src/components`, global partials in `src/components/global`, SVG partials in `src/components/svg`, and content partials in `src/components/content`.
- Data files: global data in `src/_data/*.json` and `src/_data/config.js`.
- Collections: custom modules in `collections/` for appearances, authors, paged author posts, calendar, case studies, channels, channel appearances, language/topic post slices, posts, tags, paged tags, travel posts, TWiOS posts, videos, and workshops.
- Pagination templates: `src/blog.njk`, `src/author.njk`, and `src/tag.njk`.
- Collection permalinks: blog posts map to `/blog/YYYY/MM/DD/slug/`; workshops map to `/services/workshops/slug/`; TWiOS posts map to `/this-week-in-open-source/YYYY/MM/DD/`.
- Disabled content output: appearances, authors, calendar, channels, and selected case studies use `permalink: false`.
- Filters: date formatting, markdown rendering with footnotes, slug/collection lookup helpers, tag filtering, HTML stripping, limits, attribute filters, RSS date filters, upcoming events, and author lookup.
- Shortcodes: copyright year, Turnstile site key, responsive image generation, optimized inline SVG, Mastodon URL creation, inline base64 image data, and paired `note` blocks.
- Transforms: content parser for HTML manipulation and production HTML minification.
- Plugins: Eleventy RSS, syntax highlighting, navigation, schema, and OG image generation.
- Generated feeds/files: `feed.xml`, `feed.atom`, `sitemap.xml`, `llms.txt`, `robots.txt`, and `404.html`.
- Redirects/headers: Netlify `netlify.toml` contains CSP headers, domain redirects, legacy path redirects, and fallback 404 routing.

## Migration Approach

- Preserve static output paths and Netlify deployment behavior.
- Keep SCSS and Rollup asset pipeline unless Astro can consume it with less churn.
- Keep existing Markdown frontmatter and route formulas.
- Recreate Eleventy collection behavior in Astro with shared helpers before deleting legacy Eleventy files.
- Use generated route comparison between legacy `dist` and Astro `dist` during validation.

## Current Status

- Astro renders all legacy content routes through `astro/lib/site-renderer.mjs`.
- Legacy route comparison: 456 Eleventy routes and 456 Astro routes, with no missing or extra routes.
- Eleventy filters, shortcodes, collections, pagination, RSS, Atom, sitemap, and content transforms have Astro renderer equivalents.
- Validation found no generated-route drift. Remaining local-looking missing refs are literal code examples in historical blog posts, not site navigation links.
- Legacy Eleventy config, runtime plugins, and unused transforms were removed after Astro production build passed.
